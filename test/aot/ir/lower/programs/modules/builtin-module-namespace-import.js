// RUN: lower
// OPTIONS: builtin-modules

// `import * as ns` of a module of Bun binds the module namespace object. Its names are the own enumerable names of the object that require() answers, and `default`, which holds that object.
import * as path from "node:path";
import * as jsc from "bun:jsc";
import defaultPath, { join } from "node:path";
import defaultJsc, { heapSize } from "bun:jsc";

function describe(specifier, namespace, defaultImport, required) {
  const names = [...Object.keys(required), "default"].sort();
  console.log(specifier);
  console.log("  tag:", Object.prototype.toString.call(namespace));
  console.log("  default is the default import:", namespace.default === defaultImport);
  console.log("  default is what require() answers:", namespace.default === required);
  console.log("  the namespace is another object:", namespace !== required);
  console.log("  names:", JSON.stringify(Object.keys(namespace)) === JSON.stringify(names));
  console.log("  has default:", "default" in namespace, "default" in required);
  console.log("  extensible:", Object.isExtensible(namespace), Object.isExtensible(required));
}

describe("node:path", path, defaultPath, require("node:path"));
describe("bun:jsc", jsc, defaultJsc, require("bun:jsc"));

console.log(path.join === join, path.default.join === join, path.posix.join("a", "b"));
console.log(jsc.heapSize === heapSize, jsc.default.heapSize === heapSize, typeof jsc.heapSize());
console.log(path.nothing, jsc.nothing, path.default.default, jsc.default.default);
try {
  const other = path;
  other.join = null;
} catch (error) {
  console.log(error.constructor.name);
}
console.log((await import("node:path")) === path, (await import("bun:jsc")) === jsc);
