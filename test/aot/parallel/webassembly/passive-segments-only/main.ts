// Modules whose data segments are all passive, as in Emscripten's builds with threads, and modules that mix them with active ones.
// STATISTIC: WasmFunctionsCompiled = 2
/// <reference path="../wasm-files.d.ts" />
import path from "./module.wasm";

const hash = (bytes: Uint8Array) => {
  let result = 0;
  for (let i = 0; i < bytes.length; i++) result = (Math.imul(result, 31) + bytes[i]) | 0;
  return result;
};
const attempt = (run: () => void) => {
  try {
    run();
    return "no error";
  } catch (error) {
    return (error as Error).constructor.name;
  }
};

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
for (let round = 0; round < 2; round++) {
  const exports = new WebAssembly.Instance(module).exports as any;
  console.log(hash(new Uint8Array(exports.memory.buffer)), attempt(() => exports.initializeAgain(0)), attempt(() => exports.initializeAgain(1)));
}

const unsigned = (value: number): number[] => (value < 0x80 ? [value] : [(value & 0x7f) | 0x80, ...unsigned(value >>> 7)]);
const signed = (value: number): number[] => (value < 0x40 ? [value] : [(value & 0x7f) | 0x80, ...signed(value >>> 7)]);
const section = (id: number, body: number[]) => [id, ...unsigned(body.length), ...body];
const header = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
// `kinds` names the segments: p is passive and copied by the function, a is active in the first memory, m names the first memory.
function makeModule(kinds: string, size: number) {
  const bytes = (index: number) => Array.from({ length: size }, (_, i) => (index * 37 + i * 11) & 0xff);
  const segments = [...kinds].flatMap((kind, index) => {
    const at = [0x41, ...signed(64 * index), 0x0b];
    const start = kind === "p" ? [1] : kind === "a" ? [0, ...at] : [2, 0, ...at];
    return [...start, ...unsigned(size), ...bytes(index)];
  });
  const copy = [...kinds].flatMap((kind, index) => (kind === "p" ? [0x41, ...signed(64 * index), 0x41, 0, 0x41, ...signed(size), 0xfc, 8, ...unsigned(index), 0] : []));
  const code = [0, ...copy, 0x0b];
  return new Uint8Array([
    ...header,
    ...section(1, [1, 0x60, 0, 0]),
    ...section(3, [1, 0]),
    ...section(5, [1, 0, 1]),
    ...section(7, [2, 1, 0x6d, 2, 0, 1, 0x66, 0, 0]),
    ...section(12, unsigned(kinds.length)),
    ...section(10, [1, ...unsigned(code.length), ...code]),
    ...section(11, [...unsigned(kinds.length), ...segments]),
  ]);
}
for (const kinds of ["p", "pp", "ppppp", "ap", "pa", "aaap", "mp", "pm", "am", "mm", "apapap", "p".repeat(700), "a".repeat(300) + "p".repeat(300), "apm".repeat(200)]) {
  for (const size of [0, 1, 5, 100]) {
    const exports = new WebAssembly.Instance(new WebAssembly.Module(makeModule(kinds, size))).exports as any;
    const before = hash(new Uint8Array(exports.m.buffer));
    exports.f();
    console.log(kinds.length > 10 ? kinds.length : kinds, size, before, hash(new Uint8Array(exports.m.buffer)));
  }
}
