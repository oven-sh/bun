// The global object is stored under a name of its own and read back through a captured alias.
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
globalThis.madeUpSelf = globalThis;
function outer() {
  const g = globalThis;
  return () => g.madeUpSelf;
}
console.log(outer()()[name]("1 + 1"));
