// Two modules with the same code whose passive data segments have other lengths. Both run the code in the image, and the bounds of memory.init come from the module at hand.
// STATISTIC: WasmFunctionsCompiled >= 4
// STATISTIC: WasmOptimizedCopies = 4
// STATISTIC: WasmBaselineCopies = 4
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 4
// COUNTER in every build: WasmInstancesUsingImageCode = 2
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 2
import path from "./module.wasm";
const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const encode = text => Array.from(text, character => character.charCodeAt(0));
const before = [1, 4, ...encode("abcd"), 1, 8, ...encode("efghijkl")];
const after = [1, 8, ...encode("abcdefgh"), 1, 4, ...encode("ijkl")];
const at = bytes.findIndex((_, start) => before.every((byte, index) => bytes[start + index] === byte));
const swapped = bytes.slice();
swapped.set(after, at);
function attempt(run) {
  try {
    run();
    return "ran";
  } catch (error) {
    return error.constructor.name;
  }
}
function report(label, source) {
  const { init0, init1, drop0, load } = new WebAssembly.Instance(new WebAssembly.Module(source)).exports;
  const text = () => Array.from({ length: 24 }, (_, index) => String.fromCharCode(load(index) || 46)).join("");
  console.log(label, "eight of the first:", attempt(() => init0(0, 0, 8)), text());
  console.log(label, "four of the first:", attempt(() => init0(0, 0, 4)), text());
  console.log(label, "eight of the second:", attempt(() => init1(8, 0, 8)), text());
  console.log(label, "four of the second from its second byte:", attempt(() => init1(16, 1, 4)), text());
  drop0();
  console.log(label, "one of the first after the drop:", attempt(() => init0(0, 0, 1)), "none:", attempt(() => init0(0, 0, 0)));
}
console.log("found:", at > 0, "same length:", swapped.length === bytes.length);
report("4 and 8,", bytes);
report("8 and 4,", swapped);
