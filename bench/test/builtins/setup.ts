// Generates N test files that each import the same few built-in modules and do
// nothing else. Under --isolate every file runs the top level of those modules
// again in its fresh global, so the suite measures what a built-in import costs
// a file after the first one of its process: linking and evaluation, and no parse.
//
//   bun builtins/setup.ts [files=100]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const FILES = Number(process.argv[2] ?? 100);
const dir = import.meta.dir + "/suite";

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

for (let f = 0; f < FILES; f++) {
  writeFileSync(
    `${dir}/file${String(f).padStart(3, "0")}.test.ts`,
    `import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
test("file${f}", () => {
  expect([typeof readFileSync, typeof Readable, typeof createHash, typeof gzipSync]).toEqual(new Array(4).fill("function"));
});
`,
  );
}

console.log(`wrote ${FILES} files that import node:fs, node:stream, node:crypto and node:zlib to ${dir}`);
