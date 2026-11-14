// A Worker has modules of its own, so its call gets the type that it asks for.
import { conf } from "./holder.mjs";
const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
const answer = await new Promise((resolve, reject) => {
  worker.onmessage = event => resolve(event.data);
  worker.onerror = event => reject(new Error(event.message));
});
worker.terminate();
console.log(typeof conf, answer);
