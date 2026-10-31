// Bun.file(path).text() against fs.promises.readFile(path, "utf8"), one read
// at a time and eight at once. Node has no Bun.file: (await fs.openAsBlob(path)).text() stands in.
import { mkdtempSync, openAsBlob, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, group, run } from "../runner.mjs";

const KiB = 1024;
const text = typeof Bun !== "undefined" ? path => Bun.file(path).text() : async path => (await openAsBlob(path)).text();
const eight = read => Promise.all(Array.from({ length: 8 }, read));

const units = {
  "ascii": Buffer.from("The quick brown fox jumps over the lazy dog.\n"),
  "utf8": Buffer.from("héllo wörld, 世界 💕\n"),
  // Every byte is an invalid sequence: the decoder replaces each one.
  "invalid utf8": Buffer.from([0xff]),
};

const dir = mkdtempSync(join(tmpdir(), "bun-file-text-bench-"));

function fixture(name, bytes) {
  const unit = units[name];
  const path = join(dir, `${name.replaceAll(" ", "-")}-${bytes}.txt`);
  // Whole units only, so the utf8 fixtures stay valid.
  writeFileSync(path, Buffer.alloc(bytes - (bytes % unit.length), unit));
  return path;
}

try {
  for (const bytes of [64, 4 * KiB, 256 * KiB, 8 * KiB * KiB]) {
    for (const name of Object.keys(units)) {
      const path = fixture(name, bytes);
      group(`${bytes} bytes, ${name}`, () => {
        bench("text()", async () => (await text(path)).length);
        bench('readFile(path, "utf8")', async () => (await readFile(path, "utf8")).length);
        bench("8 x text()", async () => (await eight(() => text(path))).length);
        bench('8 x readFile(path, "utf8")', async () => (await eight(() => readFile(path, "utf8"))).length);
      });
    }
  }

  await run();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
