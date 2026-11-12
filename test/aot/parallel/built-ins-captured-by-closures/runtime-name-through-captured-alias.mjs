// The closure asks the captured global object for a name that is only known at run time, and finds eval.
const name = process.argv.length > 99 ? "none" : ["ev", "al"].join("");
function outer() {
  const g = globalThis;
  return key => g[key];
}
console.log(outer()(name)("1 + 1"));
