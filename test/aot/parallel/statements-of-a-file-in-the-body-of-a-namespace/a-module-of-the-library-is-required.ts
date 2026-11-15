// @ts-nocheck
namespace Box {
  import path = require("node:path");
  export function read() { return path.basename("/a/b.txt"); }
}
let out;
try { out = Box.read(); } catch (e) { out = e.name; }
console.log(String(out));
