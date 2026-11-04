// A function that a run of the file has made reads `module` and `exports` of that run, also when the run has thrown and the file has run again.
// Todo: the names are not variables of a run: a function asks for the module object when it is called, and gets that of the last run. So did the compiler before this one.
for (let i = 0; i < 2; i++) {
  try {
    require("./t.cjs");
  } catch {}
}
globalThis.succeed = true;
require("./t.cjs");
console.log(globalThis.readers.map((read, i) => read().module === globalThis.modules[i] && read().exports === globalThis.modules[i].exports).join());
console.log(globalThis.readers.map(read => read().module.run).join());
