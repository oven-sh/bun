// A class with a static member in the Worker, an object type with that member behind the entry point.
// Flags: --aot-threads=1
// Entry points: ./worker.ts
import { table } from "./shared";
const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
worker.onmessage = event => {
  console.log(event.data + table.count);
  worker.terminate();
};
