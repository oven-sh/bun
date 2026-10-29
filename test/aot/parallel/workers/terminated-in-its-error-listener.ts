import { Worker as NodeWorker } from "node:worker_threads";

const ways: Record<string, () => void> = {
  "leaves a rejection": () => {
    Promise.reject(new Error("nobody handles this"));
  },
  "throws": () => {
    throw new Error("nobody catches this");
  },
};

if (Bun.isMainThread) {
  for (const way of Object.keys(ways)) {
    const env = { ...process.env, WAY: way };
    const webWorker = new Worker(new URL(import.meta.url), { env } as any);
    webWorker.onerror = () => webWorker.terminate();
    const closed = Promise.withResolvers<number>();
    webWorker.addEventListener("close", event => closed.resolve((event as any).code));
    console.log("web Worker", way + ":", await closed.promise);

    const nodeWorker = new NodeWorker(new URL(import.meta.url), { env });
    nodeWorker.on("error", () => nodeWorker.terminate());
    const exited = Promise.withResolvers<number>();
    nodeWorker.on("exit", exited.resolve);
    console.log("node Worker", way + ":", await exited.promise);
  }
} else {
  // The parent hears of the error while this listener runs.
  process.on("exit", () => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300));
  ways[process.env.WAY!]();
}
