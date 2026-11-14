// The name under which the exports are asked is made at run time.
// STATISTIC: FunctionsLowered >= 300
const tools = require("./tools.cjs");
const pick = tools[["pi", "ck"].join("")];
console.log(String(pick(JSON.parse("[1, [2]]"), ["fl", "at"].join("")).call([1, [2]])));
