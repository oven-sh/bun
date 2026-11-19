// A Worker is compiled code too: its `import *` of a file of data of which the main thread reads one name keeps every name.
import { one } from "./reads-one-name.mjs";
const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
const said = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
worker.terminate();
console.log(one, said);
