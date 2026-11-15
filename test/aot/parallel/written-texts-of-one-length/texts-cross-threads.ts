import { Worker, isMainThread, parentPort } from "node:worker_threads";
const short = ["alpha", "gamma", "delta", "omega"];
const long = ["x".repeat(0) + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg"];
const written = [...short, ...long];
const same = (left: string, right: string) => left === right;
function rows(texts: string[]): string {
  return texts.map(text => [written.filter(other => same(other, text)).length, written.indexOf(text), written.lastIndexOf(text), written.includes(text) ? 1 : 0, text == written[1] ? 1 : 0, text !== written[5] ? 1 : 0].join(",")).join(" ");
}
if (isMainThread) {
  const worker = new Worker(import.meta.filename);
  worker.on("message", (message: { texts: string[]; seen: string; one: string }) => {
    console.log("main", rows(message.texts), same(message.one, written[4]!), message.seen);
    worker.terminate();
  });
  worker.postMessage(written);
} else {
  parentPort!.on("message", (texts: string[]) => parentPort!.postMessage({ texts: [...written, ...texts], seen: rows(texts), one: written[5] }));
}
