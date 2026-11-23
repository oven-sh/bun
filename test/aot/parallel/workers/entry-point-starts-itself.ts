// import.meta.main is false in a worker that runs the program's own entry point.
import { isMainThread, parentPort, Worker } from "node:worker_threads";

const starts: [string, () => Worker][] = [
  ["URL", () => new Worker(new URL(import.meta.url))],
  ["filename", () => new Worker(import.meta.filename)],
  ["argv", () => new Worker(process.argv[1]!)],
  ["Bun.main", () => new Worker(Bun.main)],
];
const kind = () => (import.meta.main ? "main" : "not main");

if (isMainThread) {
  console.log("main thread:", kind(), import.meta.main);
  for (const [name, start] of starts) {
    const worker = start();
    console.log(name, await new Promise(resolve => worker.once("message", resolve)));
    await worker.terminate();
  }
} else {
  parentPort!.postMessage(`${kind()} ${import.meta.main}`);
}
