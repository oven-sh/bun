// The key is a symbol on one path and a name from run time on the other, so the definition may be under any name.
const name = process.argv.length > 99 ? "none" : ["made", "Up", "Name"].join("");
function outer() {
  const g = globalThis;
  const define = Object.defineProperty.bind(Object);
  return key => {
    define(g, key, { value: 7, configurable: true });
  };
}
const lay = outer();
lay(Symbol.for("made.up.key"));
lay(name);
console.log(globalThis.madeUpName, globalThis[Symbol.for("made.up.key")]);
