import "./a.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log("b begins");
try {
  require("./x.mjs");
  console.log("b: require(x) returns");
} catch (error) {
  console.log("b: require(x) throws", error.message);
}
console.log("b ends");
