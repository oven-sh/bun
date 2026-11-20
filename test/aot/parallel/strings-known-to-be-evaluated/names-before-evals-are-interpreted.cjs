// The free names of a function with a direct eval are the global ones as long as no eval of the file has been interpreted.
// COUNT: operation:operationAOTScopeHasBinding = 0
// COUNTER: InterpretedEvalCode = 0
function weighed(bill) {
  function load() { return String(Math.floor(bill.length / 2)); }
  function tare() { return Number(Math.max(1, 2)) + parseInt("3px"); }
  let said = "";
  for (const word of bill.split(" ")) {
    if (word === "load" || word === "tare") said += eval(word + "()");
    else said += "(" + word + ")";
  }
  return said;
}
const shown = [];
for (let i = 0; i < 20; i++) shown.push(weighed("load and tare"), weighed("tare or load or tare"));
console.log(shown.join(" "));
