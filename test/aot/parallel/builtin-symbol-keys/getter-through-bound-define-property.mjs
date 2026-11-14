// The getter goes to a bound Object.defineProperty under a symbol held in a constant. It gives the global object back, and a name from run time then finds eval on it.
const key = Symbol.for("made.up.self");
const define = Object.defineProperty.bind(Object);
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
function install() {
  define(globalThis, key, { get() { return this; } });
}
install();
const self = globalThis[key];
console.log(self === globalThis, self[name]("1 + 1"));
