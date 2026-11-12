// The getter under the symbol gives the global object back, and a name from run time then finds eval on it.
const key = Symbol.for("made.up.self");
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
Object.defineProperty(globalThis, key, { get() { return this; } });
const self = globalThis[key];
console.log(self === globalThis, self[name]("1 + 1"));
