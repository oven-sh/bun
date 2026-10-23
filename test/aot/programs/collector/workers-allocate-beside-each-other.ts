// Four Workers and the main thread run collector-runs-beside-every-kind-of-allocation.ts at the same time: five VMs, each with its own instance of the compiled program and its own collector,
// over one image and the tables that the process shares. Every thread prints the same line.
import { isMainThread, Worker } from "node:worker_threads";

const exitCodes: Promise<number>[] = [];
if (isMainThread) {
  // TODO: on Windows plain Bun does not end within 90 s with four.
  for (let i = 0; i < (process.platform === "win32" ? 1 : 4); i++) {
    const worker = new Worker(new URL(import.meta.url));
    exitCodes.push(new Promise(resolve => worker.on("exit", resolve)));
  }
}
await import("./collector-runs-beside-every-kind-of-allocation.ts");
if (isMainThread) console.log("exit codes", (await Promise.all(exitCodes)).join());
