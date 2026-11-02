// A store of Module._resolveFilename after the default function is back is asked again, however it is stored.
const Module = require("node:module");
const original = Module._resolveFilename;
const data = value => ({ value, writable: true, configurable: true, enumerable: true });
const patch = function (request, ...rest) { console.log("asked", request); return original.call(this, request === "asked" ? "node:path" : request, ...rest); };
const load = name => typeof require(process.env.NO_SUCH_VARIABLE ?? name).sep;
Module._resolveFilename = patch;
console.log(load("asked"));
Module._resolveFilename = original;
console.log(load("node:path"));
Object.defineProperty(Module, "_resolveFilename", data(patch));
console.log(load("asked"));
Module._resolveFilename = original;
console.log(load("node:path"));
Module._resolveFilename = patch;
console.log(load("asked"));
