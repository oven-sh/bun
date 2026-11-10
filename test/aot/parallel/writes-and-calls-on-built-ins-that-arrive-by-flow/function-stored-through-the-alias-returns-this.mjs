const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
function outer() {
  const g = globalThis;
  g.madeUpSelf = function () {
    return this;
  };
  return () => g.madeUpSelf();
}
console.log(outer()()[name]("1 + 1"));
