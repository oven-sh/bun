const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
function outer() {
  const g = globalThis;
  const key = Symbol.for("made.up.self");
  return () => {
    g[key] = g;
    return g[key];
  };
}
console.log(outer()()[name]("1 + 1"));
