import { WebSocketInspector, type JSC } from "bun-inspector-protocol";
import { remoteObjectToString } from "bun-inspector-protocol";

const memoryInspectorMap = new Map<URL, WebSocketInspector>();

export const heapSnapshotsMap = new Map<URL, JSC.Heap.SnapshotResponse[]>();
export const gcEventsMap = new Map<URL, JSC.Heap.GarbageCollection[]>();
export const cpuSamplesMap = new Map<URL, JSC.ScriptProfiler.Samples[]>();

interface MemoryInspectorOptions {
  url: URL;
}

export function getMemoryInspector({ url }: MemoryInspectorOptions): WebSocketInspector {
  if (memoryInspectorMap.has(url)) {
    return memoryInspectorMap.get(url)!;
  }
  const inspector = new WebSocketInspector(url);

  inspector.on("Inspector.connected", async () => {
    console.warn("Connected to memory profiler!");
    
    // Enable heap profiling
    try {
      await inspector.send("Heap.enable");
      console.warn("Heap profiling enabled");
    } catch (error) {
      console.error("Failed to enable heap profiling:", error);
    }
  });

  inspector.on("Inspector.error", error => {
    console.error("Memory inspector error:", error);
  });

  memoryInspectorMap.set(url, inspector);

  // Handle GC events
  inspector.on("Heap.garbageCollected", params => {
    const gcEvents = gcEventsMap.get(url) ?? [];
    gcEventsMap.set(url, [...gcEvents, params.collection]);
  });

  // Handle heap tracking start
  inspector.on("Heap.trackingStart", params => {
    const snapshots = heapSnapshotsMap.get(url) ?? [];
    heapSnapshotsMap.set(url, [...snapshots, {
      timestamp: params.timestamp,
      snapshotData: params.snapshotData
    }]);
  });

  // Handle heap tracking complete
  inspector.on("Heap.trackingComplete", params => {
    const snapshots = heapSnapshotsMap.get(url) ?? [];
    heapSnapshotsMap.set(url, [...snapshots, {
      timestamp: params.timestamp,
      snapshotData: params.snapshotData
    }]);
  });

  // Handle CPU profiling start
  inspector.on("ScriptProfiler.trackingStart", params => {
    console.warn(`CPU profiling started: timestamp=${params.timestamp}`);
  });

  // Handle CPU profiling complete
  inspector.on("ScriptProfiler.trackingComplete", params => {
    const samples = cpuSamplesMap.get(url) ?? [];
    if (params.samples) {
      cpuSamplesMap.set(url, [...samples, params.samples]);
    }
  });

  return inspector;
}