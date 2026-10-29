import { createRequire } from "node:module";
var __require = createRequire(import.meta.url);
function load() {
  return __require("./lib/local.cjs").name;
}
const later = () => __require("optional-peer").name;
console.log(load(), later());
