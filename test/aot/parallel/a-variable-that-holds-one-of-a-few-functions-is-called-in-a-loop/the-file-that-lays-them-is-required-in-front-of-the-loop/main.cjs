let total = "";
const tool = require("./tool.cjs");
for (let turn = 0; turn < Number("3"); turn++) {
  total += tool.name(turn);
}
console.log("end " + total);
