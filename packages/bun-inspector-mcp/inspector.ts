import { WebSocketInspector, type JSC } from "bun-inspector-protocol";
import { remoteObjectToString } from "bun-inspector-protocol";

const inspectorMap = new Map<URL, WebSocketInspector>();

export const callFramesMap = new Map<URL, JSC.Debugger.CallFrame[]>();

export const consoleMessagesMap = new Map<URL, { date: Date; message: string }[]>();

interface InspectorOptions {
  url: URL;
}

export function getInspector({ url }: InspectorOptions): WebSocketInspector {
  if (inspectorMap.has(url)) {
    return inspectorMap.get(url)!;
  }
  const inspector = new WebSocketInspector(url);

  inspector.on("Inspector.connected", async () => {
    console.warn("Connected to debugger!");
    
    // Enable the debugger
    try {
      await inspector.send("Debugger.enable");
      console.warn("Debugger enabled");
    } catch (error) {
      console.error("Failed to enable debugger:", error);
    }
  });

  inspector.on("Inspector.error", error => {
    console.error("Inspector error:", error);
  });

  inspectorMap.set(url, inspector);

  inspector.on("Debugger.paused", params => {
    const callFramesFromMap = callFramesMap.get(url) ?? [];
    callFramesMap.set(url, [...callFramesFromMap, ...params.callFrames]);
  });

  inspector.on("Console.messageAdded", params => {
    const consoleMessagesFromMap = consoleMessagesMap.get(url) ?? [];
    const message = params.message.text;
    const date = new Date();
    consoleMessagesMap.set(url, [...consoleMessagesFromMap, { date, message }]);
  });
  return inspector;
}
