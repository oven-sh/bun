// STATISTIC: DivisorVariableReadsHoisted >= 1
var held;
if (Number("1")) (held = Number("7"));
let total = 0;
for (let turn = 0; turn < Number("3"); turn++) {
  total = total * 3 + (turn % held);
}
console.log("SAID end " + total);
console.log("SAID holds " + typeof held);
function peek() {
  return held;
}
