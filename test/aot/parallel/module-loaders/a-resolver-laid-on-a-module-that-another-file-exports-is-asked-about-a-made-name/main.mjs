// The object of node:module comes through the export of another file, and the store on it is written out: a require() under a name made at run time asks the stored function.
// Todo: "none" | "./subject.js": a wrong answer today: under `bun build --compile --aot` it prints "none", where `bun <file>` prints "./subject.js". The build follows no built-in object through the export of another file, so it finds no store here and has no TS100080
import { createRequire } from "node:module";
import { Module } from "./holder.mjs";
const require = createRequire(import.meta.url);
const asked = [];
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  asked.push(request);
  return original.call(this, request, ...rest);
};
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"subject"') + ".js");
console.log(got.value, asked.join() || "none");
