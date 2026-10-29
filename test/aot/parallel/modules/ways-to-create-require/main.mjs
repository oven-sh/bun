// Every way to come by a require() made by createRequire that the build follows.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { createRequire } from "node:module";
import { createRequire as renamed } from "module";
import * as namespace from "node:module";
import whole from "node:module";
import importedProcess from "node:process";
import { kind, state } from "dual";

function early() {
  return require("./lib.cjs").name;
}
try {
  console.log(early());
} catch (error) {
  console.log(error.name);
}
const require = createRequire(import.meta.url);
function late() {
  return require("./late.cjs").twice(4);
}
console.log(globalThis.evaluations, late(), globalThis.evaluations, late(), globalThis.evaluations);
const lib = require("./lib.cjs");
console.log(early(), lib.name, require("./data.json").k, require("dep").dep, typeof require("node:fs").readFileSync);
console.log(require("./other.cjs")(), require("./lib.cjs") === lib, typeof require.resolve);
console.log(require(process.argv.length > 99 ? "./other.cjs" : "./lib.cjs").name);
try {
  require("./not-there.cjs");
} catch (error) {
  console.log(error.code);
}
const required = require("dual");
console.log(kind, required.kind, required.state === state);

const { createRequire: takenApart } = process.getBuiltinModule("node:module");
const heldModule = globalThis.process.getBuiltinModule("module");
console.log(
  createRequire(import.meta.filename)("./lib.cjs") === lib,
  renamed(import.meta.url)("./lib.cjs") === lib,
  namespace.createRequire(import.meta.url)("./lib.cjs") === lib,
  whole.createRequire(import.meta.url)("./lib.cjs") === lib,
  namespace.default.createRequire(import.meta.url)("./lib.cjs") === lib,
  process.getBuiltinModule("node:module").createRequire(import.meta.url)("./lib.cjs") === lib,
  takenApart(import.meta.url)("./lib.cjs") === lib,
  heldModule.createRequire(import.meta.url)("./lib.cjs") === lib,
  importedProcess.getBuiltinModule("node:module").createRequire(import.meta.url)("./lib.cjs") === lib,
  require("node:module").createRequire(import.meta.url)("./lib.cjs") === lib,
  (await import("node:module")).createRequire(import.meta.url)("./lib.cjs") === lib,
  (() => createRequire(import.meta.url))()("./lib.cjs") === lib,
);
console.log(require("./in-commonjs.cjs").every(loaded => loaded === lib));
