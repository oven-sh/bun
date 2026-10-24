import { Worker } from "node:worker_threads";
const worker = new Worker("./main.ts");
worker.on("message", (line: string) => console.log(line));
