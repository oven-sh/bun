// A module with two memories. Only the first can be a fast memory, so every access to the second is tested against its size.
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
new Int32Array(e.a.buffer)[1] = 1234;
console.log("data", e.readB(8), e.readA(8));
e.move(4, 12);
console.log("move", e.readB(12), new Int32Array(e.b.buffer)[3]);
console.log("sizes", e.sizes(), e.growB(2), e.sizes(), e.growB(1), e.growA(1), e.growA(1), e.sizes());
console.log("edges", e.readA(131068), outcomeOf(() => e.readA(131069)), e.readB(196604), outcomeOf(() => e.readB(196605)), outcomeOf(() => e.readB(-1)));
e.fillB(100, 7, 4);
e.copyAToB(104, 4, 4);
console.log("bulk", e.readB(100).toString(16), e.readB(104), outcomeOf(() => e.copyAToB(196605, 0, 4)), outcomeOf(() => e.copyAToB(0, 131069, 4)), outcomeOf(() => e.fillB(196608, 0, 1)));
