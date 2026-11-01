// A require() made by createRequire() finds a file of the program when it is made from import.meta.filename and when it is called with call().
import { createRequire } from "node:module";
const fromFilename = createRequire(import.meta.filename);
const fromUrl = createRequire(import.meta.url);
console.log(fromFilename("./lib.cjs").name, fromUrl.call(null, "./lib.cjs").name, globalThis.timesLoaded);
