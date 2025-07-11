import { WebSocketInspector } from "bun-inspector-protocol";

interface InspectorOptions {
  url: URL;
}
export function createInspector({ url }: InspectorOptions): WebSocketInspector {
  const inspector = new WebSocketInspector(url);

  inspector.on("Inspector.connected", () => {
    console.warn("Connected to debugger!");
  });

  inspector.on("Inspector.error", error => {
    console.error("Inspector error:", error);
  });

  return inspector;
}
