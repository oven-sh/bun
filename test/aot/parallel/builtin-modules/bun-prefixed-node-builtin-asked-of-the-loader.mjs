// The transpiler prints `fs` where it reads `bun:fs`. The loader, which every other call asks, does not know the name.
import { createRequire } from "node:module";
const tell = load => {
  try {
    return typeof load();
  } catch (error) {
    return `${error.constructor.name} ${error.code} ${error.message.split("\n")[0]}`;
  }
};
const made = createRequire(import.meta.url);
const quiet = process.argv.length > 90;
console.log(tell(() => require("bun:fs")));
console.log(tell(() => require(quiet ? "bun:os" : "bun:fs")));
console.log(require.resolve(quiet ? "bun:os" : "bun:fs"));
console.log(typeof (await import(quiet ? "bun:os" : "bun:fs")).readFileSync);
console.log(tell(() => import.meta.require("bun:fs")));
console.log(tell(() => import.meta.require(quiet ? "bun:os" : "bun:fs")));
console.log(tell(() => made("bun:fs")));
console.log(tell(() => createRequire("/")("bun:fs")));
console.log(tell(() => require.call(null, "bun:fs")));
console.log(tell(() => require.apply(null, ["bun:fs"])));
console.log(tell(() => require("bun:fs", 1)));
console.log(tell(() => process.getBuiltinModule("bun:fs")));
console.log(tell(() => process.getBuiltinModule(quiet ? "bun:os" : "bun:fs")));
console.log(tell(() => import.meta.require("fs")), tell(() => made("node:fs")), tell(() => process.getBuiltinModule("fs")));
