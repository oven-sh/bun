import { createRequire } from "node:module";
function never() {
  return [createRequire(import.meta.url)("./nothing.json"), import.meta.require("./nothing.json")];
}
console.log("SAID", typeof never);
