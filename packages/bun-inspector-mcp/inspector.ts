import { WebSocketInspector, type JSC } from "bun-inspector-protocol";
import { remoteObjectToString } from "bun-inspector-protocol";

const inspectorMap = new Map<URL, WebSocketInspector>();

export const callFramesMap = new Map<URL, JSC.Debugger.CallFrame[]>();

export const consoleMessagesMap = new Map<URL, { date: Date; message: string }[]>();

// Memory profiling state
export const heapSnapshotsMap = new Map<URL, { timestamp: number; snapshotData: string }[]>();
export const gcEventsMap = new Map<URL, JSC.Heap.GarbageCollection[]>();
export const cpuProfilesMap = new Map<URL, { timestamp: number; samples?: JSC.ScriptProfiler.Samples }[]>();

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

  // Memory profiling event handlers
  inspector.on("Heap.garbageCollected", params => {
    const gcEventsFromMap = gcEventsMap.get(url) ?? [];
    gcEventsMap.set(url, [...gcEventsFromMap, params.collection]);
  });

  inspector.on("Heap.trackingStart", params => {
    const heapSnapshotsFromMap = heapSnapshotsMap.get(url) ?? [];
    heapSnapshotsMap.set(url, [...heapSnapshotsFromMap, { timestamp: params.timestamp, snapshotData: params.snapshotData }]);
  });

  inspector.on("Heap.trackingComplete", params => {
    const heapSnapshotsFromMap = heapSnapshotsMap.get(url) ?? [];
    heapSnapshotsMap.set(url, [...heapSnapshotsFromMap, { timestamp: params.timestamp, snapshotData: params.snapshotData }]);
  });

  // CPU profiling event handlers
  inspector.on("ScriptProfiler.trackingStart", params => {
    const cpuProfilesFromMap = cpuProfilesMap.get(url) ?? [];
    cpuProfilesMap.set(url, [...cpuProfilesFromMap, { timestamp: params.timestamp }]);
  });

  inspector.on("ScriptProfiler.trackingComplete", params => {
    const cpuProfilesFromMap = cpuProfilesMap.get(url) ?? [];
    cpuProfilesMap.set(url, [...cpuProfilesFromMap, { timestamp: params.timestamp, samples: params.samples }]);
  });

  return inspector;
}
