// Each thread evaluates the modules for itself: in the main thread and in two Workers, a module that ended on a cycle whose first module threw fails whoever imports it later.
import { isMainThread, parentPort, Worker } from "node:worker_threads";

async function ask(say) {
  globalThis.say = say;
  const errors = [];
  for (const [name, start] of [
    ["first", () => import("./first.mjs")],
    ["later", () => import("./later.mjs")],
    ["later", () => import("./later.mjs")],
    ["beside", () => import("./beside.mjs")],
  ]) {
    try {
      await start();
      say(`import(${name}) resolves`);
    } catch (error) {
      if (!errors.includes(error)) errors.push(error);
      say(`import(${name}) rejects: error ${errors.indexOf(error)}, ${error.message}`);
    }
  }
}

if (isMainThread) {
  await ask(line => console.log("main:", line));
  for (const number of [1, 2]) {
    const worker = new Worker(new URL(import.meta.url));
    worker.on("message", line => console.log(`worker ${number}:`, line));
    await new Promise(resolve => worker.on("exit", resolve));
  }
} else {
  await ask(line => parentPort.postMessage(line));
}
