// The captured variable first holds an object of the program and holds the global object when the closure reads it.
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
function outer() {
  let g = { eval: () => "own" };
  const read = key => g[key];
  g = globalThis;
  return read;
}
console.log(outer()(name)("1 + 1"));
