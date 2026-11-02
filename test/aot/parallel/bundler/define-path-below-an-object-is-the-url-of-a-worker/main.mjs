// A Worker starts from a name whose `--define` value is a member of an object that holds a URL: the build compiles the file that the URL names.
// Flags: --define ENTRY=urls.w
import { Worker } from "node:worker_threads";
const urls = { w: new URL("./w.mjs", import.meta.url) };
const worker = new Worker(ENTRY);
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
