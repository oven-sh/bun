// An exported function starts a Worker from a name whose `--define` value is the `href` of its parameter, and this file passes it a URL: the build compiles the file of the URL.
// Flags: --define HREF=url.href
import { start } from "./start.mjs";
const worker = start(new URL("./w.mjs", import.meta.url));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
