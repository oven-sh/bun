// @ts-nocheck
namespace Box {
  import dep = require("./dep.cjs");
  export function read() { return dep.n; }
}
let out;
try { out = Box.read(); } catch (e) { out = e.name; }
console.log(String(out));
