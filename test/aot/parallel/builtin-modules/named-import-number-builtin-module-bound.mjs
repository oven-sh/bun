// A named import of a built-in module is the value that the module had when it was linked. A later store to the module's default object does not reach it.
import buffer, { INSPECT_MAX_BYTES } from "node:buffer";
import fs, { existsSync } from "node:fs";
import * as everything from "node:fs";
const before = INSPECT_MAX_BYTES;
buffer.INSPECT_MAX_BYTES = 1000;
console.log("a number of node:buffer:", before, INSPECT_MAX_BYTES, buffer.INSPECT_MAX_BYTES);
const original = fs.existsSync;
fs.existsSync = () => "patched";
console.log("a function of node:fs:", existsSync("/"), fs.existsSync("/"), everything.existsSync("/"), existsSync === original);
fs.existsSync = original;
