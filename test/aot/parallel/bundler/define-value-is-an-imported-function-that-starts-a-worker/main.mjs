// A name whose `--define` value is one name, the import of a function that starts a Worker from its parameter, is called with a URL: the build compiles the file.
// Flags: --define MAKE=make
import { make } from "./tools.mjs";
const worker = MAKE(new URL("./w.mjs", import.meta.url));
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
