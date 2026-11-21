// Every way to load node:path answers one object, a named import is the member of that object, and the namespace lists the names that plain Bun lists.
import path, { sep, join, posix } from "node:path";
import * as names from "node:path";
const imported = await import("node:path");
console.log("require():", require("node:path") === path);
console.log("import.meta.require():", import.meta.require("node:path") === path);
console.log("import():", imported.default === path, imported === names);
console.log(
  "process.getBuiltinModule():",
  process.getBuiltinModule("node:path") === path,
  process.getBuiltinModule("path") === path,
);
console.log("the namespace:", names.default === path, names.sep === sep, names.join === join);
console.log("named:", sep === path.sep, join === path.join, posix === path.posix);
const listed = Object.keys(names).sort();
console.log(listed.length, listed.join(" "));
console.log(Object.keys(path).sort().join(" "));
