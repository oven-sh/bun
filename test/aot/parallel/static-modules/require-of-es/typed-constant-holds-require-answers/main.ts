// A typed constant holds what require answers.
const ns: { f: typeof import("./m.js").f } = require("./m.js");
export function g() {
  return ns.f();
}
function late() {
  return require("./m.js").f();
}
console.log(g(), late());
