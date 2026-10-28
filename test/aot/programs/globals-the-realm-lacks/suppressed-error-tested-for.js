// BUN_JSC_useExplicitResourceManagement=0 takes the global SuppressedError away. A package tests for the name and goes another way without it.
// IR+ ^ +v\d+.* = String string="without"
function choose() {
  if (typeof SuppressedError !== "undefined") return "with " + typeof SuppressedError.prototype;
  return "without";
}
function chooseByMember() {
  return globalThis.SuppressedError ? "with" : "without";
}
function chooseByIn() {
  return "SuppressedError" in globalThis ? "with" : "without";
}
let line = "";
for (let round = 0; round < 300; round++) line = choose() + " " + chooseByMember() + " " + chooseByIn();
console.log(line);
