// Bench for the code frame of a printed error. `Bun.inspect(error)` reads the
// source text of the error's module and finds the error's line in it, from the
// first byte. Compare against a baseline build by running:
//
//   bun run build:release bench/sourcemap/code-frame-lines-bench.ts
//
// Each row is a module of one kind of text with an error at one line. The
// modules are written to a temporary directory.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "code-frame-lines-bench-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

const repeat = (text: string, count: number) => Buffer.alloc(Buffer.byteLength(text) * count, text).toString();

const lineCounts = [40, 300, 3_000, 30_000];
const kinds: [name: string, line: (i: number) => string, lineBreak: string, lineCounts: number[]][] = [
  ["spaces", i => `  const value${i} = Math.max(${i}, 42); // a comment`, "\n", lineCounts],
  ["tabs", i => `\t\tconst value${i} =\tMath.max(${i}, 42); // a comment`, "\n", lineCounts],
  ["\\r\\n", i => `  const value${i} = Math.max(${i}, 42); // a comment`, "\r\n", lineCounts],
  ["non-ASCII", i => `  const value${i} = "日本語のテキスト" + ${i}; // コメント`, "\n", lineCounts],
  ["lines of 2 KB", i => `const value${i} = [${repeat("42, ", 500)}];`, "\n", [40, 300]],
];

// A bundle on one line: the error is on line 1. With `first`, a tab or a non-ASCII character is near its start.
const oneLine = (first: string) =>
  `/*${first}*/${repeat("globalThis.a = 1;", 100_000)}export const error = new Error("bench");\n`;

const rows: [name: string, source: string][] = [];
for (const [name, line, lineBreak, counts] of kinds) {
  for (const count of counts) {
    const lines = Array.from({ length: count }, (_, i) => line(i));
    lines.push('export const error = new Error("bench");', "");
    rows.push([`${name}, line ${(count + 1).toLocaleString("en-US")}`, lines.join(lineBreak)]);
  }
}
rows.push(["one line of 1.7 MB", oneLine("")]);
rows.push(["one line of 1.7 MB with a tab", oneLine("\t")]);
rows.push(["one line of 1.7 MB with a non-ASCII character", oneLine("é")]);

// Microseconds for one print: the fastest of 9 rounds of about 30 ms.
function measure(error: Error): number {
  const start = performance.now();
  for (let i = 0; i < 5; i++) Bun.inspect(error);
  const calls = Math.max(5, Math.min(5_000, Math.round(150 / (performance.now() - start))));
  let fastest = Infinity;
  for (let round = 0; round < 9; round++) {
    const start = performance.now();
    for (let i = 0; i < calls; i++) Bun.inspect(error);
    fastest = Math.min(fastest, (performance.now() - start) / calls);
  }
  return fastest * 1_000;
}

for (const [i, [name, source]] of rows.entries()) {
  const path = join(dir, `module-${i}.js`);
  writeFileSync(path, source);
  const { error } = await import(path);
  if (!Bun.inspect(error).includes(" | ")) throw new Error(`${name}: the error prints no code frame`);
  console.log(`${name.padEnd(46)} ${measure(error).toFixed(1).padStart(9)} us`);
}
