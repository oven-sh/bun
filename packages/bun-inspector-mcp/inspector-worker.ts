/// <reference lib="webworker" />
import { WebSocketInspector, type JSC } from "bun-inspector-protocol";
import { remoteObjectToString } from "bun-inspector-protocol";
import { createBirpc } from "birpc";

// Persistent storage in the worker
const inspectorMap = new Map<string, WebSocketInspector>();
const callFramesMap = new Map<string, JSC.Debugger.CallFrame[]>();
const consoleMessagesMap = new Map<string, { date: Date; message: string }[]>();
const heapSnapshotsMap = new Map<string, { timestamp: number; snapshotData: string }[]>();
const gcEventsMap = new Map<string, JSC.Heap.GarbageCollection[]>();
const cpuProfilesMap = new Map<string, { timestamp: number; samples?: JSC.ScriptProfiler.Samples }[]>();

// Worker-side functions that can be called from main thread
export interface WorkerFunctions {
  registerInspector(url: string): Promise<{ connected: boolean; url: string }>;
  sendCommand(url: string, command: string, params?: any): Promise<any>;
  getCallFrames(url: string): Promise<JSC.Debugger.CallFrame[]>;
  getConsoleMessages(url: string): Promise<{ date: Date; message: string }[]>;
  getHeapSnapshots(url: string): Promise<{ timestamp: number; snapshotData: string }[]>;
  getGCEvents(url: string): Promise<JSC.Heap.GarbageCollection[]>;
  getCPUProfiles(url: string): Promise<{ timestamp: number; samples?: JSC.ScriptProfiler.Samples }[]>;
  closeInspector(url: string): Promise<void>;
}

// Main thread functions (empty for now, but can be extended)
export interface MainThreadFunctions {
  // Add functions that worker can call on main thread if needed
}

// Helper to get or create inspector
function getOrCreateInspector(urlString: string): WebSocketInspector {
  if (inspectorMap.has(urlString)) {
    return inspectorMap.get(urlString)!;
  }

  const url = new URL(urlString);
  const inspector = new WebSocketInspector(url);

  inspector.on("Inspector.connected", async () => {
    console.warn(`Connected to debugger at ${urlString}!`);
    try {
      await inspector.send("Debugger.enable");
      console.warn("Debugger enabled");
    } catch (error) {
      console.error("Failed to enable debugger:", error);
    }
  });

  inspector.on("Inspector.error", error => {
    console.error(`Inspector error for ${urlString}:`, error);
    // Clean up on error
    inspectorMap.delete(urlString);
  });

  inspector.on("Inspector.disconnected", () => {
    console.warn(`Disconnected from ${urlString}`);
    inspectorMap.delete(urlString);
  });

  inspector.on("Debugger.paused", params => {
    const existing = callFramesMap.get(urlString) ?? [];
    callFramesMap.set(urlString, [...existing, ...params.callFrames]);
  });

  // Note: Console API listening is commented out for now due to type issues
  // We'll need to update this when the proper event types are available
  // inspector.on("Runtime.consoleAPICalled", (params) => {
  //   const existing = consoleMessagesMap.get(urlString) ?? [];
  //   const messages = params.args.map(arg => remoteObjectToString(arg, true)).join(" ");
  //   const date = new Date();
  //   consoleMessagesMap.set(urlString, [...existing, { date, message: messages }]);
  // });

  // Memory profiling event handlers
  inspector.on("Heap.garbageCollected", params => {
    const existing = gcEventsMap.get(urlString) ?? [];
    gcEventsMap.set(urlString, [...existing, params.collection]);
  });

  inspector.on("Heap.trackingStart", params => {
    const existing = heapSnapshotsMap.get(urlString) ?? [];
    heapSnapshotsMap.set(urlString, [
      ...existing,
      { timestamp: params.timestamp, snapshotData: params.snapshotData },
    ]);
  });

  inspector.on("Heap.trackingComplete", params => {
    const existing = heapSnapshotsMap.get(urlString) ?? [];
    heapSnapshotsMap.set(urlString, [
      ...existing,
      { timestamp: params.timestamp, snapshotData: params.snapshotData },
    ]);
  });

  // CPU profiling event handlers
  inspector.on("ScriptProfiler.trackingStart", params => {
    const existing = cpuProfilesMap.get(urlString) ?? [];
    cpuProfilesMap.set(urlString, [...existing, { timestamp: params.timestamp }]);
  });

  inspector.on("ScriptProfiler.trackingComplete", params => {
    const existing = cpuProfilesMap.get(urlString) ?? [];
    cpuProfilesMap.set(urlString, [...existing, { timestamp: params.timestamp, samples: params.samples }]);
  });

  inspectorMap.set(urlString, inspector);
  return inspector;
}

// Worker function implementations
const workerFunctions: WorkerFunctions = {
  async registerInspector(urlString: string) {
    getOrCreateInspector(urlString);
    return { connected: true, url: urlString };
  },

  async sendCommand(urlString: string, command: string, params?: any) {
    const inspector = getOrCreateInspector(urlString);
    return await inspector.send(command as any, params);
  },

  async getCallFrames(urlString: string) {
    return callFramesMap.get(urlString) ?? [];
  },

  async getConsoleMessages(urlString: string) {
    return consoleMessagesMap.get(urlString) ?? [];
  },

  async getHeapSnapshots(urlString: string) {
    return heapSnapshotsMap.get(urlString) ?? [];
  },

  async getGCEvents(urlString: string) {
    return gcEventsMap.get(urlString) ?? [];
  },

  async getCPUProfiles(urlString: string) {
    return cpuProfilesMap.get(urlString) ?? [];
  },

  async closeInspector(urlString: string) {
    const inspector = inspectorMap.get(urlString);
    if (inspector) {
      inspector.close();
      inspectorMap.delete(urlString);
    }
    // Clear all state for this URL
    callFramesMap.delete(urlString);
    consoleMessagesMap.delete(urlString);
    heapSnapshotsMap.delete(urlString);
    gcEventsMap.delete(urlString);
    cpuProfilesMap.delete(urlString);
  }
};

// Create birpc instance for worker
const rpc = createBirpc<MainThreadFunctions, WorkerFunctions>(
  workerFunctions,
  {
    post: (data) => postMessage(data),
    on: (fn) => addEventListener("message", (e: MessageEvent) => fn(e.data)),
  }
);

// Export the rpc instance for potential future use
export { rpc };