import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const program = join(
  import.meta.dir,
  "programs",
  "escape-analysis",
  "a-fast-path-is-left-behind-the-read-of-the-method.ts",
);

// In `shelves.shelfFor(crateAt(i).label)` the method is read first. Four times in five what crateAt(i) answers is not what its type promised, so the fast path is left behind that read and the general code
// calls the method as a value: 20,000 times in this program. That value is only called, so it is the one function object that the program has for the method anyway and nothing is allocated for it.
// A place shows up in the counts with the first free list that it uses up, which is about a thousand closures.
async function closuresMade(flags: string[]) {
  using dir = tempDir("aot-method-read-only-to-be-called", { "main.ts": readFileSync(program, "utf8") });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const counts = join(folder, "counts.txt");
  built(await spawned([bunExe(), ...compileCommand, ...flags, "main.ts", "--outfile", executable], folder, env));
  const plain = await spawned([bunExe(), "main.ts"], folder, env);
  const ran = await spawned([executable], folder, { ...env, [runtimeEnvironment.countsPath]: counts });
  expect(ran).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0, signal: null });
  return readFileSync(counts, "utf8")
    .split("\n")
    .filter(line => /^allocation \S+ \S+ closure(:\S+)? /.test(line));
}

describe.concurrent("a method that is read only to be called makes no closure", () => {
  test.each([
    ["at the usual heat", []],
    ["where all code counts as hot", ["--aot-heat=everything-is-hot"]],
    ["where every call stays a call", ["--aot-disable=InlineCalls"]],
  ])("%s", (_, flags) => slot(async () => expect(await closuresMade(flags)).toEqual([])), 300_000);
});
