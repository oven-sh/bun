// The image holds a module's code. A module that differs only in its data or in a custom section has the same code and runs it; a module with other code does not.
// STATISTIC: WasmFunctionsCompiled >= 2
// STATISTIC: WasmOptimizedCopies = 2
// STATISTIC: WasmBaselineCopies = 2
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 2
// COUNTER in every build: WasmInstancesUsingImageCode = 5
// COUNTER in every build: WasmInstancesInterpreted = 1
// COUNTER in every build: WasmModulesFoundBeforeParsing = 3
import path from "./module.wasm";
const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const describe = ({ load, answer }) => Array.from({ length: 12 }, (_, index) => String.fromCharCode(load(16 + index))).join("") + " " + answer(1);
const run = source => describe(new WebAssembly.Instance(new WebAssembly.Module(source)).exports);
function replace(before, after) {
  const at = bytes.findIndex((_, start) => before.every((byte, index) => bytes[start + index] === byte));
  const copy = bytes.slice();
  copy.set(after, at);
  return copy;
}
async function stream(source, size) {
  const body = new ReadableStream({
    start(controller) {
      for (let start = 0; start < source.length; start += size) controller.enqueue(source.slice(start, start + size));
      controller.close();
    },
  });
  const response = new Response(body, { headers: { "content-type": "application/wasm" } });
  return describe((await WebAssembly.instantiateStreaming(response)).instance.exports);
}
const encode = text => Array.from(text, character => character.charCodeAt(0));
const otherData = replace(encode("made-up text"), encode("other words!"));
console.log("as built:", run(bytes));
console.log("other data:", run(otherData));
console.log("other note:", run(replace([1, 2, 3, 4], [9, 9, 9, 9])));
console.log("other code:", run(replace([0x41, 0xcd, 0x00], [0x41, 0xce, 0x00])));
console.log("as built, one byte at a time:", await stream(bytes, 1));
console.log("other data, five bytes at a time:", await stream(otherData, 5));
