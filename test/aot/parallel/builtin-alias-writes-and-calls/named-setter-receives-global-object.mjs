// The store through the alias runs a setter of the program with the global object as this. A name from run time then finds eval on what the setter kept.
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
let kept;
function outer() {
  const g = globalThis;
  Object.defineProperty(g, "madeUpSink", {
    set(value) {
      kept = this;
    },
  });
  return value => {
    g.madeUpSink = value;
  };
}
outer()(1);
console.log(kept === globalThis, kept[name]("1 + 1"));
