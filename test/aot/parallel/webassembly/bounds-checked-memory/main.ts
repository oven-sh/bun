// A memory that cannot be a fast memory is bounds-checked, and compiled code assumes a fast one: that instance is interpreted, the other is not, and the results match plain Bun.
/// <reference path="../wasm-files.d.ts" />
import path from "../many-memories/module.wasm";

function outcomeOf(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    const kind = error instanceof WebAssembly.RuntimeError ? "WebAssembly.RuntimeError" : (error as Error).name;
    const message = (error as Error).message;
    const hint = message.indexOf(" (evaluating");
    return kind + ": " + (hint < 0 ? message : message.slice(0, hint));
  }
}

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const fast = new WebAssembly.Instance(module, { env: { memory: new WebAssembly.Memory({ initial: 1 }) } }).exports as any;
const empty = new WebAssembly.Instance(module, { env: { memory: new WebAssembly.Memory({ initial: 0, maximum: 0 }) } }).exports as any;
console.log("pages", fast.pages(), empty.pages());
console.log("twice", fast.twice(21), empty.twice(21));
console.log("poke", fast.poke(8, 5), outcomeOf(() => empty.poke(8, 5)), outcomeOf(() => empty.poke(0, 5)), outcomeOf(() => empty.peek(0)));
console.log("afterwards", fast.peek(8), fast.poke(65532, 1), outcomeOf(() => fast.poke(65533, 1)));
let sum = 0;
for (let i = 0; i < 100000; i++) sum = (sum + fast.twice(i) + empty.twice(i) + fast.poke((i & 1023) * 4, i)) | 0;
console.log("many", sum);
