// A program starts a Worker with the path of a file beside it, and a part of the path is known only when the program runs. No file but this one is named when the program is built.
// Alone: which files the build compiles for a Worker depends on what else the executable holds
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { Worker as NodeWorker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
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
const chosen = process.argv[2] ?? "two";
await listen("a URL", new Worker(new URL("./jobs/" + chosen + ".ts", import.meta.url)));
await listen("its href", new Worker(new URL(`./jobs/${chosen}.ts`, import.meta.url).href));
await listen("import.meta.resolve()", new Worker(import.meta.resolve("./jobs/" + chosen + ".ts")));
await listen("require.resolve()", new Worker(require.resolve("./jobs/" + chosen)));
await listen("path.join()", new Worker(path.join(import.meta.dir, "jobs", chosen + ".ts")));
await listen("a sum", new Worker(import.meta.dirname + "/jobs/" + chosen + ".ts"));
await listen("pathToFileURL()", new Worker(pathToFileURL(path.join(import.meta.dir, "jobs", chosen + ".ts"))));
await listen("fileURLToPath()", new Worker(fileURLToPath(new URL(`./jobs/${chosen}.ts`, import.meta.url))));
const held = new URL(`./jobs/${chosen}.ts`, import.meta.url);
await listen("a URL in a const", new Worker(held));
const names = ["one", "two"];
await listen("out of a list", new Worker(new URL("./jobs/" + names[1] + ".ts", import.meta.url)));
const table: Record<string, URL> = {
  one: new URL("./jobs/one.ts", import.meta.url),
  two: new URL("./jobs/two.ts", import.meta.url),
};
await listen("out of a table", new Worker(table[chosen]));
const kind = process.argv[3] ?? "node";
await listen("node", new NodeWorker(new URL(`./jobs/of-${kind}.cjs`, import.meta.url), { workerData: 20 }));
await listen("not there", new Worker(new URL(`./jobs/${chosen}-is-not-there.ts`, import.meta.url)));
console.log(lines.join("\n"));
