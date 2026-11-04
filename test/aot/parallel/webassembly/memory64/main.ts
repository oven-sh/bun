// A memory with 64-bit addresses is never a fast memory: every access is tested against its size.
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// Env: BUN_JSC_useWasmMemory64=1
// Env of the build: BUN_JSC_useWasmMemory64=1
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
e.store(8n, 77);
console.log("load", e.load(8n), e.load(65532n), outcomeOf(() => e.load(65533n)), outcomeOf(() => e.load(1n << 32n)), outcomeOf(() => e.load(-1n)), outcomeOf(() => e.load((1n << 32n) + 8n)));
console.log("loadFar", e.loadFar(0n), outcomeOf(() => e.loadFar(1n)), outcomeOf(() => e.loadFar(-65532n)));
console.log("grow", e.size(), e.grow(1n), e.size(), e.grow(1n), e.load(131068n), outcomeOf(() => e.load(131069n)));
