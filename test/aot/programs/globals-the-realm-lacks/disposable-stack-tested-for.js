// BUN_JSC_useExplicitResourceManagement=0 takes the global DisposableStack away. A package tests for the name and goes another way without it.
// IR+ ^ +v\d+.* = String string="without"
function choose() {
  if (typeof DisposableStack !== "undefined") return "with " + typeof DisposableStack.prototype;
  return "without";
}
function chooseByMember() {
  return globalThis.DisposableStack ? "with" : "without";
}
function chooseByIn() {
  return "DisposableStack" in globalThis ? "with" : "without";
}
let line = "";
for (let round = 0; round < 300; round++) line = choose() + " " + chooseByMember() + " " + chooseByIn();
console.log(line);
