// A `--define` whose value is the `createRequire` that `process.getBuiltinModule("node:module")` hands out makes a `require` where the defined name is called: the build finds the file that it loads.
// Flags: --define CR=createRequire
const { createRequire } = process.getBuiltinModule("node:module");
const load = CR(import.meta.url);
console.log(load("./lib.cjs").name);
