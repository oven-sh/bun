// node:module: the list of built-in modules, isBuiltin, createRequire for constant names of library modules and of a file of the program, the properties of a require function and of a module object, and the caches.
import Module, { builtinModules, isBuiltin, createRequire } from "node:module";

console.log(builtinModules.includes("fs"), builtinModules.includes("node:fs"), builtinModules.includes("bun:sqlite") || builtinModules.includes("bun"), builtinModules.length > 40, Module.builtinModules === builtinModules);
console.log(isBuiltin("fs"), isBuiltin("node:fs"), isBuiltin("fs/promises"), isBuiltin("node:test"), isBuiltin("nope"), isBuiltin("node:nope"), isBuiltin("bun:jsc"));
const load = createRequire(import.meta.url);
console.log(typeof load, typeof load.resolve, typeof load.cache, load("node:os") === require("node:os"), load("node:events") === (await import("node:events")).default, load.resolve("node:fs"));
console.log(typeof require.resolve, typeof require.cache, typeof require.main, typeof require.extensions, typeof Module._load, typeof Module._resolveFilename, typeof Module._nodeModulePaths, typeof Module.wrap, typeof Module.prototype.require, typeof Module.SourceMap, typeof Module.findSourceMap, typeof Module.register, typeof Module.syncBuiltinESMExports);
console.log(Module.wrap("x"), Module._nodeModulePaths("/a/b").join());
for (const bad of ["relative/path", 1]) {
  try {
    createRequire(bad);
    console.log("accepted");
  } catch (error) {
    console.log(error.code);
  }
}
