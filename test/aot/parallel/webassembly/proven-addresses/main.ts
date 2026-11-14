// Accesses behind an access that proves their addresses to be in the memory, and behind accesses that prove nothing: at the end of the memory, around the end of the address space, and in branches and loops.
// STATISTIC: WasmOptimizedCopies = 44
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const e = new WebAssembly.Instance(module).exports as any;
const names = WebAssembly.Module.exports(module).map(entry => entry.name).filter(name => name !== "memory");
const looked = [0, 1, 2, 3, 4, 5, 8, 9, 125, 126, 127, 128, 129, 133, 256];
const pointers = [0n, 8n, 1000n, -4n, -5n, -8n, -16n, -24n, -32n, -64n, -72n, -73n, 0x1_0000_0000n, 0x7_ffff_fff8n, 0x7fff_fff0n, 0x8000_0000n];
for (const name of names) {
  const lines: string[] = [];
  // Those near the end come with the size, which the last two functions change.
  const end = BigInt(e.memory.buffer.byteLength);
  const ends = [4n, 5n, 7n, 8n, 9n, 15n, 16n, 24n, 25n, 32n, 33n, 40n, 64n, 71n, 72n, 73n].map(distance => end - distance);
  for (const p of [...pointers, ...ends]) {
    for (const q of [0n, 1n, 2048n, -8n, end - 8n, end - 16n]) {
      const before = new BigInt64Array(e.memory.buffer);
      for (const i of [...looked, ...looked.map(i => before.length - 1 - i)]) before[i] = BigInt(i % 512) * 0x1_0000_0101n + 8n;
      let result: string;
      try {
        result = String(e[name](p, q));
      } catch (error) {
        result = (error as Error).message.slice(0, 27);
      }
      const words = new BigInt64Array(e.memory.buffer);
      let sum = 0n;
      for (const i of [...looked, ...looked.map(i => words.length - 1 - i)]) sum = BigInt.asIntN(64, sum * 31n + words[i]);
      lines.push(`${p} ${q} ${result} ${sum}`);
    }
  }
  let hash = 0n;
  for (const line of lines) for (let i = 0; i < line.length; i++) hash = (hash * 31n + BigInt(line.charCodeAt(i))) & 0xffff_ffff_ffffn;
  console.log(name, lines.length, lines.filter(line => line.includes("Out of bounds")).length, hash.toString(16), lines[1], "|", lines[lines.length - 3]);
}
