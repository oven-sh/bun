import { JSON } from "bun";
import { Worker } from "node:worker_threads";
function messageOf(text: string): string {
  try {
    return JSON.stringify(JSON.parse<{ n: number }>(text));
  } catch (error: any) {
    return error.message;
  }
}
console.log("main thread:", messageOf('{"n":"1"}'));
const worker = new Worker("./main.ts");
worker.on("message", (line: string) => console.log(line, "| main thread again:", messageOf('{"n":null}')));
