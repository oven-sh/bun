// The ways in which a program writes the path of a file beside it, and starts a Worker with the path. No file but this one is named when the program is built.
// Alone: which files the build compiles for a Worker depends on what else the executable holds
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: EngineRuns = 1
import { Worker as NodeWorker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import { startItself } from "./lib/starts-itself.ts";
import { shared } from "./lib/shared.ts";
const lines: string[] = [];
const listen = (how: string, worker: any) =>
  new Promise<void>(done => {
    const end = (text: string) => (lines.push(how + ": " + text), worker.terminate(), done());
    if (worker.on) {
      worker.on("message", (data: unknown) => end("message " + JSON.stringify(data)));
      worker.on("error", (error: Error) => end("error " + error.message.split("\n")[0].slice(0, 28)));
    } else {
      worker.onmessage = (event: MessageEvent) => end("message " + JSON.stringify(event.data));
      worker.onerror = (event: ErrorEvent) => end("error " + event.message.split("\n")[0].slice(0, 28));
    }
  });
const url = new URL("./lib/typed.ts", import.meta.url);
const folder = path.join(import.meta.dir, "lib");
await listen("a URL in a const", new Worker(url));
await listen("its href", new Worker(url.href));
await listen("toString()", new Worker(url.toString()));
await listen("a folder in a const", new Worker(path.join(folder, "typed.ts")));
await listen("no extension", new Worker(path.join(folder, "typed")));
await listen("pathToFileURL", new Worker(pathToFileURL(path.join(folder, "typed.ts"))));
await listen("pathToFileURL().href", new Worker(pathToFileURL(path.join(folder, "typed.ts")).href));
await listen("fileURLToPath", new Worker(fileURLToPath(url)));
await listen("a detour", new Worker(path.resolve(import.meta.dirname, "lib", "..", "lib/./typed.ts")));
await listen("node", new NodeWorker(new URL("./lib/of-node.cjs", import.meta.url), { workerData: 20 }));
await listen("a worker that starts another", new Worker(new URL("./lib/outer.ts", import.meta.url)));
await listen("a file that starts itself", startItself());
await listen("shares a module with the main thread", new Worker(new URL("./lib/uses-shared.ts", import.meta.url)));
await listen("not there", new Worker(new URL("./lib/not-there.ts", import.meta.url)));
console.log(lines.join("\n"));
console.log(shared.count);
