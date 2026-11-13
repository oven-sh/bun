// Runs alone: it judges by the processor seconds of a build.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { test } from "./supported";

// A build runs the start of a program ahead of time to learn which patterns it makes. Where a built-in throws in that run, the
// engine goes over the frames of the calls, and the run pays for them: how deep in calls it throws does not tell how long the build takes.
async function build(folder: string, name: string, depth: number) {
  writeFileSync(
    join(folder, name + ".cjs"),
    `"use strict";
function deep(depth, kept, turns) {
  if (depth > 0) return 1 + deep(depth - 1, kept, turns);
  for (let i = 0; i < turns; i++) { try { JSON.parse("{"); } catch (e) { kept[i] = 1; } }
  return 0;
}
if (process.argv[3] === "hoard") console.log(deep(${depth}, [], 300000));
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
  return Number(built.resourceUsage()!.cpuTime.user) / 1e6;
}

test("a build takes little longer for a built-in that throws 250 calls deep", async () => {
  using dir = tempDir("aot-a-built-in-throws-deep-in-calls", {});
  const folder = String(dir);
  const shallow = await build(folder, "shallow", 0);
  const deep = await build(folder, "deep", 250);
  reads("a built-in that throws 250 calls deep", deep / shallow, 3, "times the processor seconds");
  if (!isASAN && !isDebug) expect(deep / shallow).toBeLessThan(3);
}, 240_000);
