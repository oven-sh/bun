// Faults at accesses to linear memory, in functions that set up no frame, or set it up on one arm only: the error, its stack, and what the caller keeps in registers are as with frames.
// STATISTIC: WasmOptimizedCopies = 8
// STATISTIC: WasmBaselineCopies = 8
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const e = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as any;
const memory = new DataView(e.memory.buffer);
for (let at = 0; at < 64; at += 4) memory.setInt32(at, at * 3 + 1, true);
const end = 65536;

function outcomeOf(run: () => unknown): string {
  try {
    return "returned " + run();
  } catch (error) {
    const frames = String((error as Error).stack).match(/^\s+at unknown$/gm) ?? [];
    return `${(error as Error).constructor.name}: ${(error as Error).message.replace(/ \(evaluating .*/, "")} under ${frames.length}`;
  }
}

for (let round = 0; round < 3; round++) {
  console.log("load", outcomeOf(() => e.load(4)), outcomeOf(() => e.load(end - 12)), outcomeOf(() => e.load(end - 11)), outcomeOf(() => e.load(-1)), outcomeOf(() => e.load(0x7fffffff)));
  console.log("store", outcomeOf(() => e.store(end - 8, 5n)), outcomeOf(() => e.store(end - 7, 5n)), outcomeOf(() => e.store(-8, 5n)));
  for (const calls of [0, 1]) {
    console.log("sum", calls, outcomeOf(() => e.sum(0, 4, 8, calls)), outcomeOf(() => e.sum(end, 4, 8, calls)), outcomeOf(() => e.sum(0, end, 8, calls)), outcomeOf(() => e.sum(0, 4, end, calls)));
    console.log("many", calls, outcomeOf(() => e.many(3, 5, 8, calls)), outcomeOf(() => e.many(3, 5, end, calls)));
  }
  console.log("fill", outcomeOf(() => e.fill(4096, 15)), outcomeOf(() => e.fill(4096, 100)), memory.getInt32(61440, true));
  console.log("outer", outcomeOf(() => e.outer(0, 7)), outcomeOf(() => e.outer(end, 7)));
}

// What the caller keeps in registers across a call that throws.
function keepsValues(at: number): string {
  let a = at | 1, b = a * 3, c = b ^ 5, d = c + a, f = d * 7, g = f - b, h = g ^ c;
  let thrown = 0;
  for (let i = 0; i < 200; i++) {
    try {
      a = (a + e.load(i & 1 ? end : 0)) | 0;
    } catch {
      thrown++;
    }
    b = (b + c) | 0;
    c = (c ^ d) | 0;
    d = (d + f) | 0;
    f = (f * 3 + g) | 0;
    g = (g - h) | 0;
    h = (h ^ a) | 0;
  }
  return [thrown, a, b, c, d, f, g, h].join();
}
console.log("keeps values", keepsValues(1), keepsValues(1000));

// The memory has grown: what faulted is inside now.
e.memory.grow(1);
console.log("after growing", outcomeOf(() => e.load(end)), outcomeOf(() => e.sum(0, end, 8, 1)), outcomeOf(() => e.load(2 * end)));
