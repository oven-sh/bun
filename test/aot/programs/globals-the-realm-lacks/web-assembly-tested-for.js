// BUN_JSC_useWasm=0 takes the global WebAssembly away. A package tests for the name and goes another way without it.
// IR+ ^ +v\d+.* = String string="without"
function choose() {
  if (typeof WebAssembly !== "undefined") return "with " + typeof WebAssembly.validate;
  return "without";
}
function chooseByMember() {
  return globalThis.WebAssembly ? "with" : "without";
}
function chooseByIn() {
  return "WebAssembly" in globalThis ? "with" : "without";
}
let line = "";
for (let round = 0; round < 300; round++) line = choose() + " " + chooseByMember() + " " + chooseByIn();
console.log(line);
