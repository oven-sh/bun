// A Worker starts from a URL made of a name whose `--define` value is a member of an object of the file: the build compiles the file of the URL.
// Flags: --define FILE=paths.w
import { Worker } from "node:worker_threads";
const paths = { w: "./w.mjs" };
const worker = new Worker(new URL(FILE, import.meta.url));
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
