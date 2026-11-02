// A Worker starts from a URL whose base is `import.meta.url`, and a `--define` puts a member of an object of the file in its place: the build compiles the file below the folder that the member names, not the one beside the program.
// Flags: --define import.meta.url=cfg.base
import { pathToFileURL } from "node:url";
const cfg = { base: pathToFileURL(import.meta.dirname + "/sub/").href };
const worker = new Worker(new URL("./w.mjs", import.meta.url));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
