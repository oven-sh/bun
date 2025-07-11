import { WebSocketInspector } from "bun-inspector-protocol";

const inspectorMap = new Map<URL, WebSocketInspector>();

interface InspectorOptions {
  url: URL;
}

export function getInspector({ url }: InspectorOptions): WebSocketInspector {
  if (inspectorMap.has(url)) {
    return inspectorMap.get(url)!;
  }
  const inspector = new WebSocketInspector(url);

  inspector.on("Inspector.connected", () => {
    console.warn("Connected to debugger!");
  });

  inspector.on("Inspector.error", error => {
    console.error("Inspector error:", error);
  });

  inspectorMap.set(url, inspector);
  return inspector;
}
