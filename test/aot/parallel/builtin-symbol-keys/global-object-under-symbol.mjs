// What is stored under the symbol is the global object itself, and a name from run time then finds eval on it.
const key = Symbol.for("made.up.self");
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
globalThis[key] = globalThis;
const self = globalThis[key];
console.log(self === globalThis, self[name]("1 + 1"));
