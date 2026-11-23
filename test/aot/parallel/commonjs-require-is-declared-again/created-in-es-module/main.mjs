import { createRequire } from "node:module";
function early() {
  return require("./dep.cjs").name;
}
var require = createRequire(import.meta.url);
console.log(early(), require("./dep.cjs").name);
