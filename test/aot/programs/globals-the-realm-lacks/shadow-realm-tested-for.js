// BUN_JSC_useShadowRealm=0 takes the global ShadowRealm away. A package tests for the name and goes another way without it.
// IR+ ^ +v\d+.* = String string="without"
function choose() {
  if (typeof ShadowRealm !== "undefined") return "with " + typeof ShadowRealm.prototype;
  return "without";
}
function chooseByMember() {
  return globalThis.ShadowRealm ? "with" : "without";
}
function chooseByIn() {
  return "ShadowRealm" in globalThis ? "with" : "without";
}
let line = "";
for (let round = 0; round < 300; round++) line = choose() + " " + chooseByMember() + " " + chooseByIn();
console.log(line);
