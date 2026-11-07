// Atomic reads, writes and read-modify-writes of each width on a shared memory, notify and wait, and addresses that are not aligned or not in the memory.
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

const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
const e = new WebAssembly.Instance(await moduleAt(path), { env: { memory } }).exports as any;
const ints = new Int32Array(memory.buffer);
console.log("add32", e.add32(0, 5), e.add32(0, -2), ints[0]);
console.log("sub8", e.sub8(4, 1), e.sub8(4, 1), ints[1]);
e.store(8, 0x12345678);
console.log("and16", e.and16(8, 0xff0), e.load(8).toString(16));
console.log("or64", e.or64(16, 1n << 40n), e.or64(16, 3n), e.load64(16));
console.log("xor32in64", e.xor32in64(24, 0xffffffffn), e.xor32in64(24, 1n), e.load64(24));
console.log("exchange", e.exchange(32, 9), e.exchange(32, 10), e.load(32));
console.log("compareExchange", e.compareExchange(36, 0, 7), e.compareExchange(36, 0, 8), e.compareExchange(36, 7, 9), e.load(36));
console.log("compareExchange8", e.compareExchange8(40, 0, 0x1ff), e.compareExchange8(40, 0x2ff, 1), e.load(40));
console.log("compareExchange64", e.compareExchange64(48, 0n, -1n), e.compareExchange64(48, -1n, 5n), e.load64(48));
e.store16(56, 0x12345);
console.log("store16", e.load(56).toString(16));
console.log("notify", e.notify(0, 1), "waitFor", e.waitFor(0, 99), e.waitFor(0, 3));
e.fence();
console.log("count", e.count(64, 1), e.count(64, 1000000));
console.log("unaligned", outcomeOf(() => e.load(2)), outcomeOf(() => e.add32(1, 1)), outcomeOf(() => e.load64(4)));
console.log("outside", outcomeOf(() => e.load(65536)), outcomeOf(() => e.compareExchange(-4, 0, 1)), outcomeOf(() => e.notify(65536, 1)));
