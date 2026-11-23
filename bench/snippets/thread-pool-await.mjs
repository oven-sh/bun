// Awaited calls that run on the thread pool: one at a time, several at once, and several under way.
import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, group, run } from "../runner.mjs";

const dir = mkdtempSync(join(tmpdir(), "thread-pool-await-"));
const file = join(dir, "file.txt");
writeFileSync(file, Buffer.alloc(1024, "x"));

const all = (width, call) => Promise.all(Array.from({ length: width }, call));

// `width` calls are under way at any time, and nothing awaits them together.
const stream = (width, total, call) =>
  new Promise(resolve => {
    let started = 0;
    let settled = 0;
    const next = () => {
      if (++settled === total) return resolve();
      if (started < total) start();
    };
    const start = () => {
      started++;
      call().then(next);
    };
    for (let i = 0; i < width; i++) start();
  });

group("one call at a time", () => {
  bench("await stat(file)", () => stat(file));
  bench("await readFile(1 KB)", () => readFile(file));
  bench("fs.stat(file, callback)", () => new Promise(resolve => fs.stat(file, resolve)));
});

group("calls at once", () => {
  for (const width of [2, 8, 64, 1024]) {
    bench(`Promise.all of ${width} x stat(file)`, () => all(width, () => stat(file)));
  }
});

group("calls under way", () => {
  for (const width of [2, 4, 16]) {
    bench(`${width} x stat(file) under way, 1000 calls`, () => stream(width, 1000, () => stat(file)));
  }
});

group("one call, then calls at once", () => {
  bench("await stat(file), then Promise.all of 8 x stat(file)", async () => {
    await stat(file);
    await all(8, () => stat(file));
  });
});

await run();

rmSync(dir, { recursive: true, force: true });
