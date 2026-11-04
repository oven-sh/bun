// @runtime node, bun, deno
// The rows of write-large.bun.js for fs.promises.writeFile. Every row writes the same paths again.
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, run } from "../runner.mjs";

const dir = mkdtempSync(join(tmpdir(), "bun-bench-write-large-"));
const paths = Array.from({ length: 300 }, (_, i) => join(dir, "out" + i));
const KB = 1024;
const MB = 1024 * KB;
const all = new Uint8Array(128 * MB).fill(0xab);
const bytes = size => all.subarray(0, size);
const string = Buffer.alloc(16 * MB, "a").toString("latin1");

// One write at a time.
for (const [name, source] of [
  ["300 KB Uint8Array", bytes(300 * KB)],
  ["1 MB Uint8Array", bytes(MB)],
  ["4 MB Uint8Array", bytes(4 * MB)],
  ["16 MB Uint8Array", bytes(16 * MB)],
  ["128 MB Uint8Array", bytes(128 * MB)],
  ["16 MB string", string],
  ["16 MB in 2 parts", [bytes(8 * MB), bytes(8 * MB)]],
]) {
  bench(name, async () => {
    await writeFile(paths[0], source);
  });
}

// Writes that are in flight together.
for (const [name, count, source] of [
  ["100 x 300 KB at once", 100, bytes(300 * KB)],
  ["300 x 1 MB at once", 300, bytes(MB)],
  ["100 x 4 MB at once", 100, bytes(4 * MB)],
  ["24 x 16 MB at once", 24, bytes(16 * MB)],
  ["24 x 16 MB string at once", 24, string],
]) {
  bench(name, async () => {
    await Promise.all(paths.slice(0, count).map(path => writeFile(path, source)));
  });
}

bench("16 chains of 8 x 1 MB", async () => {
  await Promise.all(
    paths.slice(0, 16).map(async path => {
      for (let i = 0; i < 8; i++) await writeFile(path, bytes(MB));
    }),
  );
});

try {
  await run();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
