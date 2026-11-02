// A name whose `--define` value is a member of an object calls a function that starts a Worker from its parameter: the build compiles the file.
// Flags: --define MAKE=tools.make
import { Worker } from "node:worker_threads";
const make = url => new Worker(url);
const tools = { make };
const worker = MAKE(new URL("./w.mjs", import.meta.url));
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
