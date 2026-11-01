// A Worker and the main thread each run the file, and each has its own object.
// Entry points: ./worker.mjs
// Alone: what is put off goes by all that the executable holds
import { read } from "./m.mjs";
const w = new Worker(new URL("./worker.mjs", import.meta.url).href);
w.onmessage = e => { console.log(e.data, "|", read().title.text); w.terminate(); };
