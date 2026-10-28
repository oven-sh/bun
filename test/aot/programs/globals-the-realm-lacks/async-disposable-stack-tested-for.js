// BUN_JSC_useExplicitResourceManagement=0 takes the global AsyncDisposableStack away. A package tests for the name and goes another way without it.
// IR+ ^ +v\d+.* = String string="without"
function choose() {
  if (typeof AsyncDisposableStack !== "undefined") return "with " + typeof AsyncDisposableStack.prototype;
  return "without";
}
function chooseByMember() {
  return globalThis.AsyncDisposableStack ? "with" : "without";
}
function chooseByIn() {
  return "AsyncDisposableStack" in globalThis ? "with" : "without";
}
let line = "";
for (let round = 0; round < 300; round++) line = choose() + " " + chooseByMember() + " " + chooseByIn();
console.log(line);
