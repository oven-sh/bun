import { createRequire } from "node:module";
class Loads { #load = createRequire(import.meta.url); go(name) { return this.#load(name); } }
new Loads().go("./third.mjs");
console.log("peer peer");
