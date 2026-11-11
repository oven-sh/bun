// What a worker of node:worker_threads finds under the names that are disabled there: the same properties, with the same attributes, in the same order, as plain Bun lays them.
import { Worker, isMainThread, parentPort } from "node:worker_threads";
const names = ["debugPort", "umask", "abort", "chdir", "setuid", "seteuid", "setgid", "setegid", "setgroups", "initgroups", "send", "disconnect", "channel", "connected"];
function look(calls: boolean): string {
  const found: string[] = [];
  for (const name of names) {
    const d = Object.getOwnPropertyDescriptor(process, name);
    let thrown = "";
    try { if (calls && d && typeof d.value === "function" && name !== "umask") d.value(); } catch (e: any) { thrown = e.code + ": " + e.message; }
    found.push(name + " " + (d ? [typeof d.value, typeof d.get, d.configurable, d.writable, d.enumerable, d.value?.disabled].join() : "none") + " " + thrown);
  }
  const own = Object.keys(process).filter(key => names.includes(key));
  return found.join("\n") + "\n" + own.join();
}
if (isMainThread) {
  console.log(look(false));
  const worker = new Worker(new URL(import.meta.url));
  console.log(await new Promise(resolve => worker.once("message", resolve)));
  await worker.terminate();
} else {
  let umask = "";
  try { process.umask(0o22); } catch (e: any) { umask = e.code; }
  parentPort!.postMessage(look(true) + "\n" + typeof process.umask() + " " + umask + " " + process.debugPort);
}
