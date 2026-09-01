// Generates the fixtures that suite.mjs and procs.ts read from <BENCH_ROOT>/fixtures.
//   bun bench/outliner/setup.ts
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.env.BENCH_ROOT ?? import.meta.dir);
const fixtures = join(root, "fixtures");
mkdirSync(fixtures, { recursive: true });
const repo = resolve(import.meta.dir, "..", "..");

await Bun.write(join(fixtures, "hello.js"), 'console.log("hello");\n');
await Bun.write(join(fixtures, "transpile-input.ts"), readFileSync(join(repo, "scripts/build/flags.ts")));

// 4 KB text file and a 1 MB binary file for the fs benchmarks
await Bun.write(join(fixtures, "small.txt"), "abcdefghijklmnopqrstuvwxyz0123456789\n".repeat(108).slice(0, 4000));
const medium = new Uint8Array(1024 * 1024);
let seed = 0x9e3779b9;
for (let i = 0; i < medium.length; i++) {
  seed = (seed * 1103515245 + 12345) >>> 0;
  medium[i] = seed >>> 24;
}
await Bun.write(join(fixtures, "medium.bin"), medium);

// a 60 KB TypeScript module and a 44 KB CommonJS module (fresh import / require benchmarks)
let ts = "";
let cjs = "";
for (let i = 0; i < 120; i++) {
  ts += `export interface Shape${i} { kind: "s${i}"; w: number; h: number; tags?: string[] }\n`;
  ts += `export function area${i}(s: Shape${i}, scale: number = 1): number {\n  const base = s.w * s.h * scale;\n  if (s.tags && s.tags.length > ${i % 5}) return base + s.tags.length;\n  return base;\n}\n`;
  ts += `export class Box${i}<T extends Shape${i}> { constructor(private readonly items: T[]) {}\n  total(): number { return this.items.reduce((acc, it) => acc + area${i}(it), 0); }\n  *iter(): Generator<T> { for (const it of this.items) yield it; }\n}\n`;
  cjs += `function area${i}(s, scale) {\n  scale = scale === undefined ? 1 : scale;\n  const base = s.w * s.h * scale;\n  if (s.tags && s.tags.length > ${i % 5}) return base + s.tags.length;\n  return base;\n}\nexports.area${i} = area${i};\nclass Box${i} { constructor(items) { this.items = items; }\n  total() { return this.items.reduce((acc, it) => acc + area${i}(it), 0); }\n}\nexports.Box${i} = Box${i};\n`;
}
await Bun.write(join(fixtures, "module.ts"), ts);
await Bun.write(join(fixtures, "module.cjs"), cjs);

// 2000 tests / 8000 expect() calls for the test runner benchmark
let tests = 'import { test, expect, describe } from "bun:test";\n';
for (let d = 0; d < 40; d++) {
  tests += `describe("group ${d}", () => {\n`;
  for (let i = 0; i < 50; i++) {
    tests += `  test("t${d}-${i}", () => { const o = { a: ${i}, b: [1, 2, ${d}], c: "x${i}" }; expect(o).toEqual({ a: ${i}, b: [1, 2, ${d}], c: "x${i}" }); expect(${i} + ${d}).toBe(${i + d}); expect("abc${i}").toContain("bc"); expect([1,2,3]).toHaveLength(3); });\n`;
  }
  tests += "});\n";
}
await Bun.write(join(fixtures, "many.test.ts"), tests);

console.log(`fixtures written to ${fixtures}`);
