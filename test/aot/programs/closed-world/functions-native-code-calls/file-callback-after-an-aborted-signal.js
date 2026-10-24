// An operation of node:fs that fails before it is scheduled calls its callback on the next tick.
import { readFile } from "node:fs";
readFile(import.meta.path, { signal: AbortSignal.abort() }, error => console.log("callback: " + error.name));
console.log("before the callback");
