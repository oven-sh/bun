// STATISTIC: VariablesThatQuietTurnsStoreReadInFrontOfLoops >= 1
var total = JSON.parse("0");
function add(turns) {
  for (let turn = 0; turn < turns; turn++) total = total + turn;
}
add(Number("10"));
console.log("SAID " + total);
total = JSON.parse("0.5");
add(Number("10"));
console.log("SAID " + total);
