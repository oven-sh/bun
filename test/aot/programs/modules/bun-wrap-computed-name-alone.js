// A program that names "bun:wrap" only by names computed at run time: the build sees nobody who names the module, so it is not in the executable. Every loader finds it all the same, as it finds any other module of Bun's that was left out, and Bun interprets it.
import { createRequire } from "node:module";
const name = "bun:" + ["wr", "ap"].join("");
async function attempt(what, load) {
  try {
    console.log(what, typeof (await load()).__toESM);
  } catch (error) {
    console.log(what, error.code, error instanceof Error);
  }
}
await attempt("import()", () => import(name));
await attempt("import.meta.require()", () => import.meta.require(name));
await attempt("createRequire()()", () => createRequire(import.meta.url)(name));
console.log("in require.cache:", Object.keys(createRequire(import.meta.url).cache).filter(key => /^bun:wrap$|prelude/.test(key)).length);
console.log("went on");
