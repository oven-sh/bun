// The text that a Worker starts from is one of several that the file writes: an arm of a condition, what stands behind || or ??, what a call passes for a parameter.
// Before: the build read one text at the constructor or none, and the others ran in the interpreter: "crashIfInterpreterIsUsed: Worker blob:..".
// Alone: which texts the build compiles for a Worker depends on what else the executable holds
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { Worker as NodeWorker } from "node:worker_threads";
const listen = (how: string, worker: any) =>
  new Promise<void>(done => {
    const end = (text: string) => (console.log(how + ": " + text), worker.terminate(), done());
    if (worker.on) {
      worker.on("message", (data: unknown) => end("message " + JSON.stringify(data)));
      worker.on("error", (error: Error) => end("error " + error.message.split("\n")[0].slice(0, 60)));
    } else {
      worker.onmessage = (event: MessageEvent) => end("message " + JSON.stringify(event.data));
      worker.onerror = (event: ErrorEvent) => end("error " + event.message.split("\n")[0].slice(0, 60));
    }
  });
const post = `require("node:worker_threads").parentPort.postMessage`;
const few = process.argv.length < 99;
await listen("eval, an arm", new NodeWorker(few ? `${post}("the first arm")` : `${post}("never, the second arm")`, { eval: true }));
await listen("eval, the other arm", new NodeWorker(!few ? `${post}("never, the first arm")` : `${post}("the other arm")`, { eval: true }));
const evaluate = (text: string) => new NodeWorker(text, { eval: true });
await listen("eval, a parameter", evaluate(`${post}("a parameter")`));
await listen("eval, the parameter again", evaluate(post + '("again")'));
const evaluateEither = (text: string, other: string) => evaluate(few ? text : other);
await listen("eval, two parameters deep", evaluateEither(`${post}("two deep")`, `${post}("never, two deep")`));
await listen("eval, behind ??", new NodeWorker(process.env.NO_SUCH_VARIABLE_HERE ?? `${post}("behind ??")`, { eval: true }));
const chosen = few ? `${post}("an arm under a name")` : `${post}("never, under a name")`;
await listen("eval, an arm under a name", new NodeWorker(chosen, { eval: true }));
const start = (url: string) => new Worker(url);
await listen("blob, a parameter", start(URL.createObjectURL(new Blob([`postMessage("a blob for a parameter")`]))));
const startWith = (code: string) => new Worker(URL.createObjectURL(new Blob([code])));
await listen("blob, its text is a parameter", startWith(`postMessage("the text of a blob for a parameter")`));
await listen("blob, its text is an arm", new Worker(URL.createObjectURL(new Blob([few ? `postMessage("the text of a blob in an arm")` : `postMessage("never")`], { type: "text/javascript" }))));
await listen("blob, an arm", new Worker(few ? URL.createObjectURL(new Blob([`postMessage("a blob in an arm")`])) : "data:text/javascript,postMessage('never')"));
await listen("blob, behind ||", new Worker(process.env.NO_SUCH_VARIABLE_HERE || URL.createObjectURL(new Blob([`postMessage("a blob behind ||")`]))));
await listen("data, the own path in an arm", new Worker(few ? "data:text/javascript," + encodeURIComponent("postMessage('" + import.meta.path + "'.length > 0)") : "data:text/javascript,postMessage('never')"));
