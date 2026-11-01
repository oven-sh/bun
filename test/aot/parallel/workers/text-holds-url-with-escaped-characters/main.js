// A module in a folder whose name holds characters that a file: URL escapes puts the URL of a file beside it into the text of a Worker.
// Alone: which files the build compiles for a Worker depends on what else the executable holds
import { start } from "./~[odd]^name/starts.js";
const worker = start();
worker.onmessage = event => (console.log("import() of a URL:", event.data), worker.terminate());
worker.onerror = event => (console.log("error", event.message.split("\n")[0].slice(0, 27)), worker.terminate());
