// Each of twelve live instances has its own memory, more than plain Bun's limit on fast memories: compiled code runs with every one.
/// <reference path="../wasm-files.d.ts" />
// Env: BUN_AOT_TYPE_ERROR_LOG=stderr
// Env: BUN_AOT_TYPE_ERROR_LOG_FORMAT=json
// Env: BUN_JSC_crashIfInterpreterIsUsed=1
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

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const memories: WebAssembly.Memory[] = [];
const instances: WebAssembly.Instance[] = [];
for (let i = 0; i < 12; i++) {
  memories.push(new WebAssembly.Memory({ initial: 1, maximum: 2 }));
  instances.push(new WebAssembly.Instance(module, { env: { memory: memories[i] } }));
}
let sum = 0;
for (let i = 0; i < instances.length; i++) sum += (instances[i].exports.poke as (at: number, value: number) => number)(i * 4, i * 10);
console.log(sum);
console.log(memories.map((memory, i) => new Int32Array(memory.buffer)[i]).join());
console.log(outcomeOf(() => (instances[11].exports.poke as (at: number, value: number) => number)(65536, 1)));
/* Output:
672
0,10,20,30,40,50,60,70,80,90,100,110
WebAssembly.RuntimeError: Out of bounds memory access
*/
