// A write of one string: Bun.write beside fs.promises.writeFile. It runs in Bun and in Node.
//
//   in call  until the call returns its promise
//   stall    the longest time that the JS thread is held, from the call to the end of the write
//   total    until the promise settles
//
// Each row is the median of ROUNDS writes. A "spaced" write comes 150 ms after the write
// before it and makes a new file. By then the allocator has given the memory of a freed copy
// of the string back to the OS. A "back-to-back" write follows the write before it at once
// and replaces the file of that write.
//
// On POSIX, Bun.write writes a string below 0.25 M characters on the JS thread.
//
//   bun bench/snippets/write-string.mjs [sizes in M characters, default 0.125,0.5,4,32,128]
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const M = 1024 * 1024;
const ROUNDS = 5;
const sizes = (process.argv[2] ?? "0.125,0.5,4,32,128").split(",").map(Number);

// A character is 1 byte of the file for ASCII, 2 for Latin-1 and 3 for UTF-16.
const kinds = {
  "ASCII": length => Buffer.alloc(length, "a").toString("latin1"),
  "Latin-1": length => Buffer.alloc(length, 0xe9).toString("latin1"),
  "UTF-16": length => Buffer.alloc(length * 2, "\u4e2d", "utf16le").toString("utf16le"),
};
const apis = {
  ...(typeof Bun !== "undefined" && { "Bun.write": (path, string) => Bun.write(path, string) }),
  "fs.promises.writeFile": (path, string) => writeFile(path, string),
};

async function time(write, path, string) {
  let pending = true;
  let stall = 0;
  let idle;
  const stopped = new Promise(resolve => (idle = resolve));
  const start = performance.now();
  let last = start;
  const promise = write(path, string);
  const inCall = performance.now() - start;
  setImmediate(function turn() {
    const now = performance.now();
    stall = Math.max(stall, now - last);
    last = now;
    if (pending) setImmediate(turn);
    else idle();
  });
  await promise;
  const total = performance.now() - start;
  pending = false;
  await stopped;
  return { inCall, stall, total };
}

function row(api, label, samples) {
  const median = key => samples.map(sample => sample[key]).sort((a, b) => a - b)[samples.length >> 1];
  const ms = key => median(key).toFixed(3).padStart(8);
  console.log(`  ${api.padEnd(22)} ${label.padEnd(13)} ${ms("inCall")} ${ms("stall")} ${ms("total")}`);
}

const dir = mkdtempSync(join(tmpdir(), "bun-bench-write-string-"));
const runtime =
  typeof Bun !== "undefined" ? `bun ${Bun.version} (${Bun.revision.slice(0, 9)})` : `node ${process.version}`;
console.log(`# ${runtime}, ms, median of ${ROUNDS}`);
try {
  for (const size of sizes) {
    for (const [kind, make] of Object.entries(kinds)) {
      const string = make(size * M);
      console.log(
        `${size} M characters of ${kind}`.padEnd(39) +
          "in call".padStart(9) +
          "stall".padStart(9) +
          "total".padStart(9),
      );
      for (const [api, write] of Object.entries(apis)) {
        const spaced = [];
        for (let round = 0; round < ROUNDS; round++) {
          const path = join(dir, `spaced-${round}`);
          await sleep(150);
          spaced.push(await time(write, path, string));
          rmSync(path);
        }
        row(api, "spaced", spaced);
        const path = join(dir, "back-to-back");
        const backToBack = [];
        await write(path, string);
        for (let round = 0; round < ROUNDS; round++) backToBack.push(await time(write, path, string));
        rmSync(path);
        row(api, "back-to-back", backToBack);
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
