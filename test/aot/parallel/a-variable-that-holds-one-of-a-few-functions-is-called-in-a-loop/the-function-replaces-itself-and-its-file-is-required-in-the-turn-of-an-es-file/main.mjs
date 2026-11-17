import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let total = "";
for (let turn = 0; turn < Number("3"); turn++) {
  const tool = require("./tool.cjs");
  total += tool.name(turn);
}
console.log("end " + total);
