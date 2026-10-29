import { createRequire } from "node:module";
var __require = createRequire(import.meta.url);
let peer = null;
try {
  peer = __require("not-installed");
} catch (error) {
  console.log(error.code);
}
console.log(peer, __require("./lib/local.cjs").name);
