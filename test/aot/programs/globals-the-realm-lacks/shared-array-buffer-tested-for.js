// BUN_JSC_useSharedArrayBuffer=0 takes the global SharedArrayBuffer away. A package tests for the name and goes another way without it.
// IR+ ^ +v\d+.* = String string="without"
function choose() {
  if (typeof SharedArrayBuffer !== "undefined") return "with " + typeof SharedArrayBuffer.prototype;
  return "without";
}
function chooseByMember() {
  return globalThis.SharedArrayBuffer ? "with" : "without";
}
function chooseByIn() {
  return "SharedArrayBuffer" in globalThis ? "with" : "without";
}
let line = "";
for (let round = 0; round < 300; round++) line = choose() + " " + chooseByMember() + " " + chooseByIn();
console.log(line);
