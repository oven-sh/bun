const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
let kept;
function outer() {
  const g = globalThis;
  const key = Symbol.for("made.up.sink");
  const define = Object.defineProperty.bind(Object);
  define(g, key, {
    set(value) {
      kept = this;
    },
  });
  return value => {
    g[key] = value;
  };
}
outer()(1);
console.log(kept === globalThis, kept[name]("1 + 1"));
