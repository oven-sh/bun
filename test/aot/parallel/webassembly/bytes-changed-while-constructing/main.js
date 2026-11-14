// The bytes of a module are taken when the constructor is entered: whatever the program's own code does to them before the parse changes nothing.
// STATISTIC: WasmOptimizedCopies = 3
// STATISTIC: WasmBaselineCopies = 0
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 0
// COUNTER in every build: WasmInstancesUsingImageCode = 9
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 10
import path from "../float-constants/module.wasm";
const original = new Uint8Array(await Bun.file(path).arrayBuffer());
const answerOf = module => new WebAssembly.Instance(module).exports.scale(2);
const outcomeOf = run => {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
};

console.log("a typed array", outcomeOf(() => answerOf(new WebAssembly.Module(original.slice()))));
console.log("an ArrayBuffer", outcomeOf(() => answerOf(new WebAssembly.Module(original.slice().buffer))));
console.log("a DataView", outcomeOf(() => answerOf(new WebAssembly.Module(new DataView(original.slice().buffer)))));

const padded = new Uint8Array(original.length + 24);
padded.set(original, 16);
console.log("the middle of a buffer", outcomeOf(() => answerOf(new WebAssembly.Module(padded.subarray(16, 16 + original.length)))));
console.log("one byte short", outcomeOf(() => answerOf(new WebAssembly.Module(padded.subarray(16, 15 + original.length)))));
console.log("one byte more", outcomeOf(() => answerOf(new WebAssembly.Module(padded.subarray(16, 17 + original.length)))));

const shared = new Uint8Array(new SharedArrayBuffer(original.length));
shared.set(original);
console.log("shared bytes", outcomeOf(() => answerOf(new WebAssembly.Module(shared))));

{
  const bytes = original.slice();
  const target = new Proxy(function () {}, {
    get(object, key, receiver) {
      if (key === "prototype") bytes.fill(0);
      return Reflect.get(object, key, receiver);
    },
  });
  console.log("cleared by new.target's prototype", outcomeOf(() => answerOf(Reflect.construct(WebAssembly.Module, [bytes], target))), bytes[0]);
}

{
  const bytes = original.slice();
  const options = {
    get builtins() {
      bytes.fill(0);
      return undefined;
    },
    get importedStringConstants() {
      bytes.fill(0);
      return undefined;
    },
  };
  console.log("cleared by the options' getters", outcomeOf(() => answerOf(new WebAssembly.Module(bytes, options))));
}

{
  const bytes = original.slice();
  const module = new WebAssembly.Module(bytes);
  bytes.fill(0);
  console.log("cleared after the constructor", outcomeOf(() => answerOf(module)));
}

class Derived extends WebAssembly.Module {}
console.log("a derived class", outcomeOf(() => answerOf(new Derived(original.slice()))), new Derived(original.slice()) instanceof Derived);
console.log("no bytes", outcomeOf(() => new WebAssembly.Module()), outcomeOf(() => new WebAssembly.Module(new Uint8Array(0))));
