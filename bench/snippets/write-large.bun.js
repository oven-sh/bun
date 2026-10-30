// Bun.write of a source too large for the synchronous path (256 KB), so a work-pool job writes it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, run } from "../runner.mjs";

const dir = mkdtempSync(join(tmpdir(), "bun-bench-write-large-"));
const out = join(dir, "out.bin");
const KB = 1024;
const MB = 1024 * KB;

for (const [label, size] of [
  ["300 KB", 300 * KB],
  ["4 MB", 4 * MB],
  ["16 MB", 16 * MB],
  ["128 MB", 128 * MB],
]) {
  const bytes = new Uint8Array(size).fill(0xab);
  bench(`await Bun.write(path, Uint8Array(${label}))`, async () => {
    await Bun.write(out, bytes);
  });
}

const blob = new Blob([new Uint8Array(16 * MB).fill(0xab)]);
bench("await Bun.write(path, Blob(16 MB))", async () => {
  await Bun.write(out, blob);
});

const string = Buffer.alloc(16 * MB, "a").toString("latin1");
bench("await Bun.write(path, string(16 MB))", async () => {
  await Bun.write(out, string);
});

// Writes that are awaited together, not one at a time.
for (const [label, size, count] of [
  ["300 KB", 300 * KB, 100],
  ["4 MB", 4 * MB, 100],
  ["16 MB", 16 * MB, 24],
]) {
  const bytes = new Uint8Array(size).fill(0xab);
  const paths = Array.from({ length: count }, (_, i) => join(dir, "burst" + i));
  bench(`await Promise.all(${count} x Bun.write(path, Uint8Array(${label})))`, async () => {
    await Promise.all(paths.map(path => Bun.write(path, bytes)));
  });
}

await run();
rmSync(dir, { recursive: true, force: true });
