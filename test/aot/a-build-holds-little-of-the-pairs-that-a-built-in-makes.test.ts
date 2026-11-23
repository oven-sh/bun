// Runs alone: it judges by the memory that a build holds.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { test } from "./supported";

// A build runs the start of a program ahead of time to learn which patterns it makes, and that run ends at a count of what it
// has made. Object.entries makes a list of pairs: each pair is a list of its own, and is counted as one.
async function build(folder: string, name: string, turns: number) {
  writeFileSync(
    join(folder, name + ".cjs"),
    `"use strict";
function load(turns) {
  const kept = [];
  const shape = {};
  for (let k = 0; k < 1000; k++) shape["k" + k] = k;
  for (let i = 0; i < turns; i++) kept[i] = Object.entries(shape);
  return kept.length;
}
if (process.argv[3] === "hoard") console.log(load(${turns}));
function word(n) { return "a" + (n % 7); }
console.log(new RegExp(word(9)).source);
`,
  );
  await using built = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `./${name}.cjs`,
      "--outfile",
      join(folder, name + (isWindows ? ".exe" : "")),
    ],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  return built.resourceUsage()!.maxRSS;
}

test("a build holds little of 7000 lists of a thousand pairs, on a way that the program never goes", async () => {
  using dir = tempDir("aot-pairs-that-a-built-in-makes", {});
  const folder = String(dir);
  const room = 256 * 1024 * 1024;
  const one = await build(folder, "one", 1);
  const many = await build(folder, "many", 7000);
  reads(
    "what a build holds of 7000 lists of a thousand pairs",
    (many - one) / room,
    1.4,
    "times the room of a build's first run",
  );
  if (!isASAN && !isDebug) expect((many - one) / room).toBeLessThan(1.4);
}, 240_000);
