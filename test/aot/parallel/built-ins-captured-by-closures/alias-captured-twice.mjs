// A closure in a closure captures the alias again.
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
function outer() {
  const g = globalThis;
  return () => key => [typeof g.Array, g[key]("1 + 1")];
}
console.log(outer()()(name).join());
