// The payload of an executable goes in behind what is loaded, and pushes back whatever the carrier holds behind that: its symbols and its debug information,
// tens or hundreds of megabytes in a Bun that has them. They arrive whole, and the build never has them resident.
import { expect } from "bun:test";
import { bunExe, isLinux, tempDir } from "harness";
import { appendFileSync, chmodSync, closeSync, copyFileSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { measureCommandWithMemory } from "./analysis-scaling/measure-check";
import { withoutDebugInformation } from "./harness/commands";
import { run as spawn } from "./harness/run";
import { test } from "./supported";

const megabyte = 1024 * 1024;
const blocks = 96;
const blockAt = (index: number) => Buffer.alloc(megabyte, `block ${index} of what stands behind the payload; `);

test.skipIf(!isLinux)(
  "what a carrier holds behind the payload arrives whole and is never resident",
  async () => {
    using dir = tempDir("aot-carrier-tail", { "main.js": "console.log(40 + 2);\n" });
    const cwd = String(dir);
    const short = withoutDebugInformation()[1] ?? bunExe();
    const long = join(cwd, "carrier-with-a-tail");
    copyFileSync(short, long);
    // The copy has the mode of the Bun under test, which may not be writable.
    chmodSync(long, 0o755);
    for (let index = 0; index < blocks; index++) appendFileSync(long, blockAt(index));

    const build = (carrier: string, out: string) =>
      measureCommandWithMemory(cwd, [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-threads=1",
        "--compile-executable-path",
        carrier,
        "--outfile",
        out,
        "main.js",
      ]);
    const withoutTail = await build(short, "short");
    const withTail = await build(long, "long");

    const ran = await spawn([join(cwd, "long")], cwd);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "42\n", exitCode: 0 });

    // Where the table of section headers is the end of a carrier it is written anew in its place, and otherwise behind all else: the lengths say nothing.
    const longSize = statSync(join(cwd, "long")).size;
    const file = openSync(join(cwd, "long"), "r");
    try {
      const marker = blockAt(0).subarray(0, 64);
      const window = Buffer.alloc(2 * megabyte);
      let start = -1;
      // A Bun that leaves out what the program does not use makes an executable that is shorter than its carrier: the tail may begin anywhere.
      for (let at = 0; start < 0 && at < longSize; at += megabyte) {
        const found = window.subarray(0, readSync(file, window, 0, window.length, at)).indexOf(marker);
        if (found >= 0) start = at + found;
      }
      expect(start).toBeGreaterThan(0);
      const held = Buffer.alloc(megabyte);
      const wrong: number[] = [];
      for (let index = 0; index < blocks; index++) {
        readSync(file, held, 0, megabyte, start + index * megabyte);
        if (!held.equals(blockAt(index))) wrong.push(index);
      }
      expect(wrong).toEqual([]);
    } finally {
      closeSync(file);
    }

    expect(Math.round((withTail.peakBytes - withoutTail.peakBytes) / megabyte)).toBeLessThan(blocks / 4);
  },
  120_000,
);
