// A loop of WebAssembly grows its memory in every turn and writes and reads the last byte.
// STATISTIC: WasmFunctionsCompiled >= 2
import path from "./m.wasm";
const load = async (path, imports = {}) => new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer())), imports).exports;
const tried = f => { try { return f(); } catch (e) { return e instanceof WebAssembly.RuntimeError ? "T" : e instanceof RangeError ? "R" : e instanceof TypeError ? "Y" : "E"; } };
const e = await load(path);
console.log(e.size(), e.growInLoop(5), e.size(), e.growInLoop(100), e.size(), e.memory.buffer.byteLength);
