const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
function outer() {
  const g = globalThis;
  return () => g.valueOf();
}
const self = outer()();
console.log(self === globalThis, self[name]("1 + 1"));
