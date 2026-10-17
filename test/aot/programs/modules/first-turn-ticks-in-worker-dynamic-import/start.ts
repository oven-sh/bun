import { existsSync } from "node:fs";
const worker = new Worker("./main.ts");
worker.onmessage = (event: MessageEvent) => {
  console.log(typeof existsSync, event.data);
  worker.terminate();
};
