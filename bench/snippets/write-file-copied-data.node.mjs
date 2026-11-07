// @runtime node, bun
// fs.promises.writeFile of data that the write job cannot read in place. bun reads an ASCII
// string or a buffer of the caller in place. It has its own copy of the other sources here.
// The rows of mitata write one file at a time. The bursts start every write before they await
// one. The chains await each write before the next one. Each burst and each chain runs in a new
// process, because a process that has run one has its memory to use again.
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const KB = 1024;
const MB = 1024 * KB;
// Each gives a source that is `size` bytes in the file.
const sources = {
  "ASCII": size => Buffer.alloc(size, "a").toString("latin1"),
  "Latin-1": size => Buffer.alloc(size / 2, 0xe9).toString("latin1"),
  // 3 bytes for each CJK character, and 1 byte for each "a" that fills the rest.
  "UTF-16": size => {
    const units = Buffer.alloc((Math.floor(size / 3) + (size % 3)) * 2, "\u4e2d", "utf16le");
    units.fill("a", units.length - (size % 3) * 2, units.length, "utf16le");
    return units.toString("utf16le");
  },
  "base64": size => Buffer.alloc(size, "a").toString("base64"),
  "resizable view": size => new Uint8Array(new ArrayBuffer(size, { maxByteLength: 2 * size })).fill(0x61),
};
const encoding = kind => (kind === "base64" ? "base64" : "utf8");
const label = size => (size >= MB ? size / MB + " MB" : size / KB + " KB");

const dir = mkdtempSync(join(tmpdir(), "bun-bench-write-file-copied-data-"));
try {
  const mode = process.argv[2];
  if (mode === "burst" || mode === "chain") {
    const [kind, count, size] = [process.argv[3], Number(process.argv[4]), Number(process.argv[5])];
    const source = sources[kind](size);
    const paths = Array.from({ length: count }, (_, i) => join(dir, "out" + i));
    const faults = process.resourceUsage().minorPageFault;
    const start = performance.now();
    if (mode === "burst") await Promise.all(paths.map(path => writeFile(path, source, encoding(kind))));
    else for (let i = 0; i < count; i++) await writeFile(paths[0], source, encoding(kind));
    const ms = performance.now() - start;
    const usage = process.resourceUsage();
    console.log(
      `${count} x ${label(size)} ${kind} ${mode === "burst" ? "at once" : "in a chain"}`.padEnd(38) +
        `${ms.toFixed(0)} ms`.padStart(9) +
        `${usage.minorPageFault - faults} minor faults`.padStart(22) +
        `${(usage.maxRSS / KB).toFixed(0)} MB peak RSS`.padStart(18),
    );
  } else {
    // First, while this process is small: a child starts with the peak RSS of its parent.
    if (!process.env.BENCHMARK_RUNNER) {
      for (const [mode, kind, count, size] of [
        ["burst", "ASCII", 300, MB],
        ["burst", "UTF-16", 1500, 300 * KB],
        ...["Latin-1", "UTF-16", "base64", "resizable view"].map(kind => ["burst", kind, 300, MB]),
        ["chain", "UTF-16", 16, 32 * MB],
        ["chain", "resizable view", 16, 32 * MB],
      ]) {
        spawnSync(process.execPath, [fileURLToPath(import.meta.url), mode, kind, count, size].map(String), {
          stdio: "inherit",
        });
      }
    }

    const { bench, run } = await import("../runner.mjs");
    const path = join(dir, "out");
    for (const [kind, size] of [
      ["ASCII", 12],
      ["UTF-16", 12],
      ...Object.keys(sources).flatMap(kind => [16 * KB, 300 * KB, MB, 16 * MB].map(size => [kind, size])),
    ]) {
      const source = size === 12 ? (kind === "ASCII" ? "short string" : "short \u4e2d\u6587") : sources[kind](size);
      bench(`${size === 12 ? "12 B" : label(size)} ${kind}`, async () => {
        await writeFile(path, source, encoding(kind));
      });
    }
    const chain = sources["UTF-16"](MB);
    const paths = Array.from({ length: 16 }, (_, i) => join(dir, "chain" + i));
    bench("16 chains of 8 x 1 MB UTF-16", async () => {
      await Promise.all(
        paths.map(async path => {
          for (let i = 0; i < 8; i++) await writeFile(path, chain);
        }),
      );
    });
    await run();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
