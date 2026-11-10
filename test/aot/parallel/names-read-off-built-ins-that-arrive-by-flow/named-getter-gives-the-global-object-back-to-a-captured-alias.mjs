const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
Object.defineProperty(globalThis, "madeUpSelf", { get() { return this; } });
function outer() {
  const g = globalThis;
  return () => g.madeUpSelf;
}
const self = outer()();
console.log(self === globalThis, self[name]("1 + 1"));
