// RUN: lower
// OPTIONS: builtin-modules

// process.getBuiltinModule with a literal name is an import site. A name that is no built-in module gives undefined and loads no file.
const path = process.getBuiltinModule("node:path");
console.log(path.posix.join("a", "b"), path === require("node:path"), process.getBuiltinModule("path") === path);
console.log(typeof process.getBuiltinModule("bun:jsc").heapStats, typeof process.getBuiltinModule?.("node:os").EOL);
console.log(process.getBuiltinModule("./get-builtin-module-literal.js"), process.getBuiltinModule("node:nope"), process.getBuiltinModule("left-pad"));
