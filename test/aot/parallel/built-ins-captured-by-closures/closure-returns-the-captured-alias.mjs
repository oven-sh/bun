// The closure gives the captured global object back, and its caller finds eval on it by a name from run time.
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
function outer() {
  const g = globalThis;
  return () => g;
}
console.log(outer()()[name]("1 + 1"));
