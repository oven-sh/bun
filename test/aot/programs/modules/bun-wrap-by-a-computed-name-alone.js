// A program that names "bun:wrap" only by names computed at run time: the module is compiled with it all the same.
import { createRequire } from "node:module";
const name = "bun:" + ["wr", "ap"].join("");
const imported = await import(name);
const required = import.meta.require(name), created = createRequire(import.meta.url)(name);
console.log(typeof imported.__toESM, imported === required, required === created, imported.__toESM({ a: 1 }).a);
console.log(Object.keys(createRequire(import.meta.url).cache).filter(key => /^bun:wrap$|prelude/.test(key)).join());
