// A file that hands its import.meta on starts the worker files beside it all the same.
import { Worker } from "node:worker_threads";
import { start } from "./starts-itself.ts";

const isMainFile = (meta: ImportMeta) => meta.url === `file://${process.argv[1]}`;
const meta = import.meta;
console.log(typeof isMainFile(import.meta), typeof import.meta, meta.main);

const answerOf = (worker: Worker) => new Promise(resolve => worker.once("message", resolve)).finally(() => worker.terminate());
console.log(await answerOf(new Worker(new URL("./first.ts", import.meta.url))));
console.log(await answerOf(new Worker(new URL("second.ts", import.meta.url))));
const url = new URL("./third.ts", import.meta.url);
console.log(await answerOf(new Worker(url)));
console.log(await answerOf(start()));
