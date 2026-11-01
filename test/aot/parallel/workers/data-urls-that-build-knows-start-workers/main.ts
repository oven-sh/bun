// The ways in which a program writes a data: URL that is known when it is built, and the ways on which the URL reaches the constructor of a Worker.
// Alone: which texts the build compiles for a Worker depends on what else the executable holds
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: EngineRuns = 1
import * as threads from "node:worker_threads";
import defaultThreads, { Worker as NodeWorker } from "node:worker_threads";
import { url as imported } from "./other.ts";
const { Worker: Destructured } = require("node:worker_threads");
const required = require("worker_threads");
const lines: string[] = [];
const listen = (how: string, worker: any) =>
  new Promise<void>(done => {
    const end = (text: string) => (lines.push(how + ": " + text), worker.terminate(), done());
    if (worker.on) {
      worker.on("message", (data: unknown) => end("message " + JSON.stringify(data)));
      worker.on("error", (error: Error) => end("error " + error.message.split("\n")[0].slice(0, 60)));
    } else {
      worker.onmessage = (event: MessageEvent) => end("message " + JSON.stringify(event.data));
      worker.onerror = (event: ErrorEvent) => end("error " + event.message.split("\n")[0].slice(0, 60));
    }
  });
const held = "data:text/javascript,postMessage('a const')";
const type = "text/javascript";
const body = "postMessage('a template')";
const begin = (url: string) => new Worker(url);
await listen("literal", new Worker("data:text/javascript,postMessage('a literal')"));
await listen("const", new Worker(held));
await listen("template", new Worker(`data:${type},${body}`));
await listen("sum", new Worker("data:" + type + "," + "postMessage('a sum')"));
await listen("parameter", begin("data:text/javascript,postMessage('a parameter')"));
await listen("conditional", new Worker(process.argv.length > 99 ? "data:text/javascript,postMessage('never')" : "data:text/javascript,postMessage('a conditional')"));
await listen("or", new Worker(process.env.NO_SUCH_VARIABLE_HERE || "data:text/javascript,postMessage('an or')"));
await listen("imported", new Worker(imported));
await listen("as", new Worker("data:text/javascript,postMessage('an assertion')" as string));
await listen("globalThis.Worker", new globalThis.Worker("data:text/javascript,postMessage('globalThis.Worker')"));
await listen("percent", new Worker("data:text/javascript,postMessage(%22percent%20encoded%22)"));
await listen("base64", new Worker("data:text/javascript;base64,cG9zdE1lc3NhZ2UoImJhc2U2NCIp"));
await listen("encodeURIComponent", new Worker("data:text/javascript," + encodeURIComponent("postMessage('é € 😀 % # ?')")));
await listen("btoa", new Worker("data:text/javascript;base64," + btoa("postMessage('btoa')")));
await listen("typescript", new Worker("data:application/typescript,const n: number = 4; postMessage(n satisfies number)"));
await listen("URL", new Worker(new URL("data:text/javascript,postMessage('a URL')")));
await listen("URL with a space and a hash", new Worker(new URL("data:text/javascript,postMessage('a b#c?d')")));
await listen("URL of non-ASCII", new Worker(new URL("data:text/javascript,postMessage('é')")));
await listen("options", new Worker("data:text/javascript,postMessage('options ' + self.name)", { name: "named" }));
await listen("node import", new NodeWorker(new URL("data:text/javascript,postMessage('node, imported')")));
await listen("node namespace", new threads.Worker(new URL("data:text/javascript,postMessage('node, a namespace')")));
await listen("node default", new defaultThreads.Worker(new URL("data:text/javascript,postMessage('node, the default')")));
await listen("node destructured", new Destructured(new URL("data:text/javascript,postMessage('node, destructured')")));
await listen("node required", new required.Worker(new URL("data:text/javascript,postMessage('node, required')")));
await listen("node require().Worker", new (require("node:worker_threads").Worker)(new URL("data:text/javascript,postMessage('node, require().Worker')")));
await listen("node workerData", new NodeWorker(new URL("data:text/javascript,import { workerData, parentPort } from 'node:worker_threads'; parentPort.postMessage(workerData)"), { workerData: { a: 1 } }));
await listen("twice 1", new Worker("data:text/javascript,postMessage('twice')"));
await listen("twice 2", new Worker("data:text/javascript,postMessage('twice')"));
await listen("nested", new Worker(`data:text/javascript,const inner = new Worker("data:text/javascript,postMessage('the inner one')"); inner.onmessage = event => postMessage("nested: " + event.data)`));
console.log(lines.join("\n"));
