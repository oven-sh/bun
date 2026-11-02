// Some members of host objects are functions written in Bun's library. A program that reads one and never calls it gets the function that plain Bun has there, and nothing the compiler believes about the value is false: the build validates what it assumes.
// Flags: --aot-validate
import Module, { _initPaths } from "node:module";
import process from "node:process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function describe(label, held) {
  console.log(label, typeof held, held.length, Object.getOwnPropertyNames(held).sort().join());
}
const byDefault = Module._initPaths;
describe("by the default export", byDefault);
describe("by a named import", _initPaths);
describe("by require", require("node:module")._initPaths);
console.log("one object:", byDefault === _initPaths, byDefault === require("node:module")._initPaths, byDefault === Module["_init" + "Paths"]);

const debug = process._rawDebug;
describe("process._rawDebug", debug);
console.log("one object:", debug === process._rawDebug, debug === process["_raw" + "Debug"]);

const load = process.loadEnvFile;
describe("process.loadEnvFile", load);
console.log("one object:", load === process.loadEnvFile, load === byDefault, debug === byDefault);

const held = [byDefault, debug, load];
console.log(held.map(f => f instanceof Function).join(), new Set(held).size);
