// A store through a name whose `--define` value is a member of an object puts a function there that starts a Worker from its parameter, and the member is called with a URL: the build compiles the file.
// Flags: --define SLOT=tools.make
import { Worker } from "node:worker_threads";
const tools = {};
SLOT = url => new Worker(url);
const worker = tools.make(new URL("./w.mjs", import.meta.url));
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
