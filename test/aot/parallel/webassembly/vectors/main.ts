// 128-bit vectors: in memory, in locals across a loop, through a call, as constants, and at the edge of memory. JavaScript can neither hand one over nor take one.
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

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
async function moduleAt(path: string) {
  return new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

const e = new WebAssembly.Instance(await moduleAt(path)).exports as any;
const ints = new Int32Array(e.memory.buffer);
const floats = new Float32Array(e.memory.buffer);
const bytes = new Uint8Array(e.memory.buffer);
ints.set([1, 2, 3, 2147483647, 10, 20, 30, 1], 4);
e.addLanes(0, 16, 32);
console.log("addLanes", ints.slice(0, 4).join());
for (let i = 0; i < 64; i++) floats[64 + i] = i * 0.5, (floats[128 + i] = 2);
console.log("dot", e.dot(256, 512, 0), e.dot(256, 512, 1), e.dot(256, 512, 16));
for (let i = 0; i < 16; i++) bytes[1024 + i] = i % 3 ? 0x80 + i : i;
console.log("masks", e.mask8(1024), e.mask16(1024), e.mask32(1024), e.mask64(1024));
e.reversed(1040, 1024);
console.log("reversed", bytes.slice(1040, 1056).join());
console.log("throughCall", e.throughCall(5), e.throughCall(-1));
console.log("outOfBounds", outcomeOf(() => e.outOfBounds()));
console.log("takesVector", outcomeOf(() => e.takesVector(1)));
