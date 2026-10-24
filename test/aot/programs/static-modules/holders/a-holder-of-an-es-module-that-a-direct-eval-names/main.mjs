// A constant that holds what import.meta.require() gave is named by the text of a direct eval: it holds the namespace object, not a stand-in.
const a = import.meta.require("./es.mjs");
console.log(eval("a.x"), typeof eval("a"));
const b = import.meta.require("./m.cjs");
console.log(eval("b.x"), typeof eval("b"));
function f() {
  const c = import.meta.require("./es.mjs");
  return eval("typeof c + c.x");
}
console.log(f());
