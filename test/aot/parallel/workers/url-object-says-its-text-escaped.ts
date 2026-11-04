// A data: URL comes to a Worker as a URL object, which says the text as the parser of URLs writes it: what is no ASCII is escaped, blanks around it are gone, the scheme is in lower case.
// Before: the build compiled the text under the URL as it is written, and the run time looked under what the object says: "crashIfInterpreterIsUsed: Worker data:text/javascript,postMessage('%C3%A9')".
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
const held = "data:text/javascript,postMessage('ü under a name')";
const begin = (url: URL) => new Worker(url);
await listen("at the constructor", new Worker(new URL("data:text/javascript,postMessage('é €')")));
await listen("through a parameter", begin(new URL(held)));
await listen("its href", new Worker(new URL("data:text/javascript,postMessage('ö, its href')").href));
await listen("as a text", new Worker("data:text/javascript,postMessage('ä, as a text')"));
await listen("blanks around it", new Worker(new URL("  data:text/javascript,postMessage('blanks around it')  ")));
await listen("the scheme in capitals", new Worker(new URL("DATA:text/javascript,postMessage('capitals')")));
await listen("with a base", new Worker(new URL("data:text/javascript,postMessage('å, with a base')", import.meta.url)));
await listen("node", new NodeWorker(new URL("data:text/javascript,postMessage('ñ, node')")));
