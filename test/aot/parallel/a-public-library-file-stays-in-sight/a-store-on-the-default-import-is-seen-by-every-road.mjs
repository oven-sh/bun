// A store on the record is a store on the one object; the variable of the named import keeps what the loader took.
import fs, { existsSync } from "node:fs";
import { createRequire } from "node:module";
const original = fs.existsSync;
fs.existsSync = () => "mine";
console.log(fs.existsSync("/"), existsSync("/"), original === existsSync, createRequire(import.meta.url)("node:fs").existsSync("/"));
