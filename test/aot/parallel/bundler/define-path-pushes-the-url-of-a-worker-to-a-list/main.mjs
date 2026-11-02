// A name whose `--define` value is the `push` of a list adds a URL to it, and a Worker starts from its first place: the build compiles the file.
// Flags: --define ADD=files.push
import { Worker } from "node:worker_threads";
const files = [];
ADD(new URL("./w.mjs", import.meta.url));
const worker = new Worker(files[0]);
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
