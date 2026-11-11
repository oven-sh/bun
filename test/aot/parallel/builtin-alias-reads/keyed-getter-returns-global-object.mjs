// The getter that the program laid under the key gets the global object as this. A name from run time then finds eval on what it returns.
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
const key = Symbol.for("made.up.self");
Object.defineProperty(globalThis, key, { get() { return this; } });
function outer() {
  const g = globalThis;
  return () => g[key];
}
const self = outer()();
console.log(self === globalThis, self[name]("1 + 1"));
