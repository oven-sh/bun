import type { JSC } from "bun-inspector-protocol";
import { createBirpc } from "birpc";
import type { WorkerFunctions, MainThreadFunctions } from "./inspector-worker";

// Create a singleton worker instance
let worker: Worker | null = null;
let rpc: ReturnType<typeof createBirpc<WorkerFunctions, MainThreadFunctions>> | null = null;

// Initialize worker and birpc lazily
function getWorkerRpc() {
  if (!worker || !rpc) {
    worker = new Worker(new URL("./inspector-worker.ts", import.meta.url).href);
    
    // Main thread functions that worker can call (empty for now)
    const mainThreadFunctions: MainThreadFunctions = {};
    
    // Create birpc instance
    rpc = createBirpc<WorkerFunctions, MainThreadFunctions>(
      mainThreadFunctions,
      {
        post: (data) => worker!.postMessage(data),
        on: (fn) => worker!.addEventListener("message", (e) => fn(e.data)),
      }
    );
  }
  return rpc;
}

// Proxy object that mimics WebSocketInspector interface
class InspectorProxy {
  constructor(public url: URL) {}

  async send(command: string, params?: any): Promise<any> {
    const rpc = getWorkerRpc();
    return await rpc.sendCommand(this.url.toString(), command, params);
  }

  async close(): Promise<void> {
    const rpc = getWorkerRpc();
    await rpc.closeInspector(this.url.toString());
  }
}

interface InspectorOptions {
  url: URL;
}

export function getInspector({ url }: InspectorOptions): InspectorProxy {
  // Register the inspector with the worker
  const rpc = getWorkerRpc();
  rpc.registerInspector(url.toString()).catch(error => {
    console.error("Failed to register inspector:", error);
  });

  return new InspectorProxy(url);
}

// Export functions that delegate to worker via birpc
export async function getCallFrames(url: URL): Promise<JSC.Debugger.CallFrame[]> {
  const rpc = getWorkerRpc();
  return await rpc.getCallFrames(url.toString());
}

export async function getConsoleMessages(url: URL): Promise<{ date: Date; message: string }[]> {
  const rpc = getWorkerRpc();
  const messages = await rpc.getConsoleMessages(url.toString());
  // Convert date strings back to Date objects if needed
  return messages.map(msg => ({
    ...msg,
    date: msg.date instanceof Date ? msg.date : new Date(msg.date),
  }));
}

export async function getHeapSnapshots(url: URL): Promise<{ timestamp: number; snapshotData: string }[]> {
  const rpc = getWorkerRpc();
  return await rpc.getHeapSnapshots(url.toString());
}

export async function getGCEvents(url: URL): Promise<JSC.Heap.GarbageCollection[]> {
  const rpc = getWorkerRpc();
  return await rpc.getGCEvents(url.toString());
}

export async function getCPUProfiles(url: URL): Promise<{ timestamp: number; samples?: JSC.ScriptProfiler.Samples }[]> {
  const rpc = getWorkerRpc();
  return await rpc.getCPUProfiles(url.toString());
}

// Export these for backward compatibility with the Map-like interface
export const callFramesMap = {
  get: getCallFrames,
};

export const consoleMessagesMap = {
  get: getConsoleMessages,
};

export const heapSnapshotsMap = {
  get: getHeapSnapshots,
};

export const gcEventsMap = {
  get: getGCEvents,
};

export const cpuProfilesMap = {
  get: getCPUProfiles,
};