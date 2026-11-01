// CI tests every build of Bun, whoever changed whatever, and the tests of the ahead-of-time compiler had doubled some of its lanes. So CI runs the test files that
// ../every-build.txt names and the stored programs that ../parallel/every-build.txt names. The rest is for a change to the compiler.
//
// AOT_WHOLE=1: everything. A build of CI whose commit message holds `[aot whole]` is one.
// AOT_WHOLE=0: what CI runs. A test file that the list lacks declares one skipped test and does nothing else.
// Neither, outside CI: a file that is named runs.
//
// A test file takes `test`, `describe` and the hooks from ./declare.ts or from ../supported.ts, not from bun:test.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

// test/preload.ts has deleted every BUILDKITE_* variable by the time a test file loads. A program that CI starts without it still has them.
function commitMessage(): string {
  if (process.env.BUILDKITE_MESSAGE !== undefined) return process.env.BUILDKITE_MESSAGE;
  return spawnSync("git", ["log", "-1", "--format=%B"], { cwd: import.meta.dir, encoding: "utf8" }).stdout ?? "";
}
if (process.env.AOT_WHOLE === undefined && process.env.CI)
  process.env.AOT_WHOLE = commitMessage().includes("[aot whole]") ? "1" : "0";

export const runsWhole = process.env.AOT_WHOLE === "1";
export const runsTheListAlone = process.env.AOT_WHOLE === "0";

const linesOf = (...path: string[]) =>
  readFileSync(join(import.meta.dir, "..", ...path), "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));

/** Seconds of processor time of a release on Linux x64, by the path below `test`, with `/`. */
export const everyBuild = new Map(
  linesOf("every-build.txt").map(line => [line.slice(line.indexOf(" ") + 1), Number(line.slice(0, line.indexOf(" ")))]),
);
export const isLeftOut = (path: string, theListAlone = runsTheListAlone) => theListAlone && !everyBuild.has(path);

/** Whether CI leaves out the stored program at this path below `test/aot/parallel`. A line of its list is a program or the beginning of a path. */
export function isProgramLeftOut(path: string, theListAlone = runsTheListAlone): boolean {
  storedPrograms ??= linesOf("parallel", "every-build.txt");
  return theListAlone && !storedPrograms.some(line => path.startsWith(line));
}
let storedPrograms: string[] | undefined;

/** The path of the test file that is being loaded, if it is left out. One process may load many, and loads this file once. */
export function leftOutHere(): string | undefined {
  const path = relative(join(import.meta.dir, "..", ".."), Bun.main).replaceAll("\\", "/");
  return isLeftOut(path) ? path : undefined;
}
