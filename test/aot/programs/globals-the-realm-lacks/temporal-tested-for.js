// BUN_JSC_useTemporal=0 takes the global Temporal away. A package tests for the name and goes another way without it.
// IR+ ^ +v\d+.* = String string="without"
function choose() {
  if (typeof Temporal !== "undefined") return "with " + typeof Temporal.Now;
  return "without";
}
function chooseByMember() {
  return globalThis.Temporal ? "with" : "without";
}
function chooseByIn() {
  return "Temporal" in globalThis ? "with" : "without";
}
let line = "";
for (let round = 0; round < 300; round++) line = choose() + " " + chooseByMember() + " " + chooseByIn();
console.log(line);
