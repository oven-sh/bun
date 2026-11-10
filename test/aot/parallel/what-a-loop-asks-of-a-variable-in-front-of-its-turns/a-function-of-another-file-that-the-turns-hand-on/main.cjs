// STATISTIC: FunctionsOfOtherFilesReadInFrontOfLoops >= 1
const tool = require("./tool.cjs");
function apply(given, value) {
  return typeof given === "function" ? given(value) : -2;
}
let total = 0;
for (let turn = 0; turn < Number("3"); turn++) {
  total = total * 3 + (apply(tool.held, turn));
}
console.log("SAID end " + total);
console.log("SAID holds " + typeof tool.held);
