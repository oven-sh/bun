import { Worker, isMainThread, parentPort } from "node:worker_threads";

export async function run() {
  let file = new URL(import.meta.url);
  if (process.argv.length < 99) file = new URL("./other.ts", import.meta.url);
  const helper = new Worker(file);
  helper.on("message", word => console.log("message", word));
  helper.on("error", error => console.log("error", String(error.message).slice(0, 11)));
  await new Promise(done => helper.on("exit", done));
}
if (!isMainThread) parentPort!.postMessage("the file itself");
