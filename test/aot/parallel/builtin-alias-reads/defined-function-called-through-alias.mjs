// The function that the program laid under the name is read through the alias and called with the alias as this.
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
globalThis.madeUpSelf = function () {
  return this;
};
function outer() {
  const g = globalThis;
  return () => g.madeUpSelf();
}
console.log(outer()()[name]("1 + 1"));
