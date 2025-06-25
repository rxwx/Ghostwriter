import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        image: {
            setImage: (options: { src: string; alt?: string; title?: string }) => ReturnType;
        };
    }
}

interface ImageOptions {
    HTMLAttributes: Record<string, any>;
}

const Image = Node.create<ImageOptions>({
    name: "image",
    group: "block",
    draggable: true,

    addAttributes() {
        return {
            src: {
                default: null,
            },
            alt: {
                default: null,
            },
            title: {
                default: null,
            },
            width: {
                default: null,
            },
            height: {
                default: null,
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: "img",
            },
        ];
    },

    renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
        return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
    },

    addCommands() {
        return {
            setImage:
                (options: { src: string; alt?: string; title?: string }) =>
                ({ commands }: { commands: any }) =>
                    commands.insertContent({
                        type: this.name,
                        attrs: options,
                    }),
        };
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey("imageUpload"),
                props: {
                    handlePaste: (view: EditorView, event: ClipboardEvent) => {
                        const items = Array.from(event.clipboardData?.items || []);
                        const imageItem = items.find((item: DataTransferItem) => item.type.startsWith("image/"));

                        if (imageItem) {
                            event.preventDefault();
                            const file = imageItem.getAsFile();
                            if (file) {
                                uploadImage(file, view);
                            }
                            return true;
                        }
                        return false;
                    },
                    handleDrop: (view: EditorView, event: DragEvent) => {
                        const files = Array.from(event.dataTransfer?.files || []);
                        const imageFile = files.find(file => file.type.startsWith("image/"));

                        if (imageFile) {
                            event.preventDefault();
                            uploadImage(imageFile, view);
                            return true;
                        }
                        return false;
                    },
                },
            }),
        ];
    },
});

async function uploadImage(file: File, view: EditorView) {
    try {
        // Convert file to base64
        const base64 = await fileToBase64(file);

        // Extract the base64 data
        const base64Data = base64.split(',')[1];

        // Get current context
        const reportIdElement = document.getElementById("graphql-evidence-report-id");
        const findingIdElement = document.getElementById("graphql-evidence-finding-id");

        const reportId = reportIdElement ? parseInt(reportIdElement.innerHTML) : null;
        const findingId = findingIdElement ? parseInt(findingIdElement.innerHTML) : null;

        // Prepare variables
        const variables: any = {
            file_base64: base64Data,
            filename: file.name,
            friendly_name: file.name.replace(/\.[^/.]+$/, ""),
            caption: `Image: ${file.name}`,
            description: "Image uploaded via paste or drag-and-drop",
        };

        // Upload to the finding or report
        if (findingId) {
            variables.finding = findingId;
        } else if (reportId) {
            variables.report = reportId;
        } else {
            console.error("No report or finding context found for image upload");
            return;
        }

        // POST to the uploadEvidence endpoint
        const response = await fetch("/v1/graphql", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${document.getElementById("graphql-auth")?.innerHTML || ""}`,
            },
            body: JSON.stringify({
                query: `
                    mutation UploadEvidence($file_base64: String!, $filename: String!, $friendly_name: String!, $caption: String!, $description: String, $report: Int, $finding: Int) {
                        uploadEvidence(file_base64: $file_base64, filename: $filename, friendly_name: $friendly_name, caption: $caption, description: $description, report: $report, finding: $finding) {
                            id
                        }
                    }
                `,
                variables: variables
            }),
        });

        if (response.ok) {
            const result = await response.json();

            if (result.data?.uploadEvidence) {
                const evidenceId = result.data.uploadEvidence.id;

                const evidenceResponse = await fetch("/v1/graphql", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${document.getElementById("graphql-auth")?.innerHTML || ""}`,
                    },
                    body: JSON.stringify({
                        query: `
                            query GetEvidence($id: bigint!) {
                                evidence_by_pk(id: $id) {
                                    id
                                    document
                                    friendlyName
                                }
                            }
                        `,
                        variables: {
                            id: evidenceId
                        }
                    }),
                });

                if (evidenceResponse.ok) {
                    const evidenceResult = await evidenceResponse.json();

                    if (evidenceResult.data?.evidence_by_pk) {
                        const evidence = evidenceResult.data.evidence_by_pk;

                        const mediaUrl = document.getElementById("graphql-media-url")?.innerHTML || "";
                        const fullImageUrl = mediaUrl + evidence.document;

                        const { tr } = view.state;
                        const imageNode = view.state.schema.nodes.image.create({
                            src: fullImageUrl,
                            alt: evidence.friendlyName,
                            title: evidence.friendlyName,
                        });
                        tr.insert(view.state.selection.from, imageNode);
                        view.dispatch(tr);
                    }
                }
            } else if (result.errors) {
                console.error("GraphQL errors:", result.errors);
            }
        } else {
            console.error("Image upload failed:", response.statusText);
        }
    } catch (error) {
        console.error("Error uploading image:", error);
    }
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                resolve(reader.result);
            } else {
                reject(new Error("Failed to read file"));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export default Image;