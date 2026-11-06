// Entry points: ./worker.ts
// Reference: bun build --compile
import { Worker } from "node:worker_threads";
const worker = new Worker("./worker.ts");
worker.on("message", (line: string) => console.log(line));
