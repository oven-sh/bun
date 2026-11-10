const start = () => new Thread(import.meta.filename);
const { Worker: Thread, isMainThread, parentPort } = await import("node:worker_threads");
export let answer = "none";
if (isMainThread) {
  const worker = start();
  answer = await new Promise(resolve => worker.once("message", resolve));
  await worker.terminate();
} else {
  parentPort.postMessage("the file answers itself");
}
