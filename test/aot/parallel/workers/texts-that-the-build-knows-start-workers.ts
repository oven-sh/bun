// Texts that are known when the program is built and that reach a Worker as code to evaluate or behind an object URL.
// Alone: which texts the build compiles for a Worker depends on what else the executable holds
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: EngineRuns = 1
import { Worker as NodeWorker } from "node:worker_threads";
const threads = require("node:worker_threads");
const Aliased = threads.Worker;
const lines: string[] = [];
const short = (value: unknown) => JSON.stringify(value).replace(/blob:[-0-9a-f]+/g, "blob:..");
const listen = (how: string, worker: any) =>
  new Promise<void>(done => {
    const end = (text: string) => (lines.push(how + ": " + text), worker.terminate(), done());
    if (worker.on) {
      worker.on("message", (data: unknown) => end("message " + short(data)));
      worker.on("error", (error: Error) => end("error " + error.message.split("\n")[0].slice(0, 60)));
    } else {
      worker.onmessage = (event: MessageEvent) => end("message " + short(event.data));
      worker.onerror = (event: ErrorEvent) => end("error " + event.message.split("\n")[0].slice(0, 60));
    }
  });
const post = `require("node:worker_threads").parentPort.postMessage`;
const code = `${post}("a const")`;
await listen("eval, a literal", new NodeWorker(`require("node:worker_threads").parentPort.postMessage("a literal")`, { eval: true }));
await listen("eval, a const", new NodeWorker(code, { eval: true }));
await listen("eval, a sum", new NodeWorker(post + "(" + '"a sum"' + ")", { eval: true }));
await listen("eval, one of two", new NodeWorker(process.argv.length > 99 ? `${post}("never")` : `${post}("one of two")`, { eval: true }));
const evaluate = (text: string) => new NodeWorker(text, { eval: true });
await listen("eval, a parameter", evaluate(`${post}("a parameter")`));
await listen("eval, more options", new NodeWorker(`${post}(require("node:worker_threads").workerData)`, { workerData: [1, 2], eval: true, name: "n" }));
await listen("eval, a namespace", new threads.Worker(`${post}("a namespace")`, { eval: true }));
await listen("eval, an alias", new Aliased(`${post}("an alias")`, { eval: true }));
await listen("eval, an ES module", new NodeWorker(`import { parentPort } from "node:worker_threads"; parentPort.postMessage([import.meta.url, import.meta.main])`, { eval: true }));
await listen("eval, TypeScript", new NodeWorker(`const n: number = 4; ${post}(n)`, { eval: true }));
await listen("eval, what it sees", new NodeWorker(`${post}([__filename, __dirname, module.filename, module.path, module.id, require.main.filename, Bun.main, process.argv.slice(1), typeof this, new Error("x").stack.split("\\n")[1]])`, { eval: true }));
await listen("eval, sloppy", new NodeWorker(`x = 1; ${post}([x, (function () { return typeof this; })()])`, { eval: true }));
await listen("eval, awaits", new NodeWorker(`${post}(await Promise.resolve(3))`, { eval: true }));
await listen("eval, throws", new NodeWorker(`throw new RangeError("thrown")`, { eval: true }));
await listen("eval: false", new NodeWorker(new URL("data:text/javascript,postMessage('eval: false')"), { eval: false }));
await listen("blob, no type", new Worker(URL.createObjectURL(new Blob([`postMessage("no type")`]))));
await listen("blob, an empty type", new Worker(URL.createObjectURL(new Blob([`postMessage("an empty type")`], { type: "" }))));
await listen("blob, text/javascript", new Worker(URL.createObjectURL(new Blob([`postMessage("text/javascript")`], { type: "text/javascript" }))));
await listen("blob, application/javascript", new Worker(URL.createObjectURL(new Blob([`postMessage("application/javascript")`], { type: "application/javascript" }))));
await listen("blob, application/typescript", new Worker(URL.createObjectURL(new Blob([`const n: number = 5; postMessage(n)`], { type: "application/typescript" }))));
await listen("blob, TEXT/JAVASCRIPT", new Worker(URL.createObjectURL(new Blob([`postMessage("upper case")`], { type: "TEXT/JAVASCRIPT" }))));
await listen("blob, text/plain", new Worker(URL.createObjectURL(new Blob([`postMessage("text/plain")`], { type: "text/plain" }))));
await listen("blob, parts", new Worker(URL.createObjectURL(new Blob(["postMessage(", `"parts"`, ")"], { type: "text/javascript" }))));
const blob = new Blob([`postMessage("a blob in a const")`], { type: "text/javascript" });
const url = URL.createObjectURL(blob);
await listen("blob, in consts", new Worker(url));
await listen("blob, non-ASCII", new Worker(URL.createObjectURL(new Blob([`postMessage("é€😀")`]))));
await listen("blob, what it sees", new Worker(URL.createObjectURL(new Blob([`postMessage([import.meta.url, import.meta.path, import.meta.dir, import.meta.file, import.meta.main, Bun.main, process.argv.slice(1), new Error("x").stack.split("\\n")[1]])`]))));
await listen("blob, twice 1", new Worker(URL.createObjectURL(new Blob([`postMessage("twice")`]))));
await listen("blob, twice 2", new Worker(URL.createObjectURL(new Blob([`postMessage("twice")`]))));
await listen("blob, imports", new Worker(URL.createObjectURL(new Blob([`import { EOL } from "node:os"; postMessage(EOL.length)`]))));
console.log(lines.join("\n"));
