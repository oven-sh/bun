// The Worker hands its class to a function that both import.
// Flags: --aot-threads=1
// Entry points: ./worker.ts
import { make } from "./shared";
const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
worker.onmessage = event => {
  console.log(event.data + make({ create: () => ({ value: -1 }) }));
  worker.terminate();
};
