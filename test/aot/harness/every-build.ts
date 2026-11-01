// CI tests every build of Bun, whoever changed whatever, and the tests of the ahead-of-time compiler had doubled some of its lanes. So CI runs the test files that
// ../every-build.txt names and the stored programs that ../parallel/every-build.txt names. The rest is for a change to the compiler.
//
// AOT_WHOLE=1: everything. A build of CI whose commit message holds `[aot whole]` is one.
// AOT_WHOLE=0: what CI runs. A test file that ../every-build.txt leaves out declares one skipped test and does nothing else.
// Neither, which is so outside CI: a file that is named runs.
//
// A test file that may be left out takes `test`, `describe` and the hooks from ./declare.ts or from ../supported.ts, not from bun:test.
//
// test/harness.ts imports this file through ../hardened.ts, so it takes nothing from there, and it is evaluated before test/harness.ts deletes what Buildkite has set.
// What it sets stays in the environment, for whatever is started from here.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

if (process.env.BUILDKITE_BUILD_NUMBER)
  process.env.AOT_WHOLE ??= process.env.BUILDKITE_MESSAGE?.includes("[aot whole]") ? "1" : "0";

export const runsWhole = process.env.AOT_WHOLE === "1";
export const runsTheListAlone = process.env.AOT_WHOLE === "0";

export const linesOf = (...path: string[]) =>
  readFileSync(join(import.meta.dir, "..", ...path), "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));

let lists: { everyBuild: Map<string, number>; leftOutElsewhere: Set<string> } | undefined;
function read() {
  if (lists) return lists;
  const lines = linesOf("every-build.txt").map(line => [line.slice(0, line.indexOf(" ")), line.slice(line.indexOf(" ") + 1)]);
  return (lists = {
    everyBuild: new Map(lines.filter(([word]) => word !== "off").map(([seconds, path]) => [path, Number(seconds)])),
    leftOutElsewhere: new Set(lines.filter(([word]) => word === "off").map(([, path]) => path)),
  });
}
/** What runs: seconds of processor time of a release on Linux x64, by the path below `test`, with `/`. */
export const everyBuild = () => read().everyBuild;
/** The test files outside `test/aot` that are left out. A file there that the list does not name is none of its business. */
export const leftOutElsewhere = () => read().leftOutElsewhere;

export const isLeftOut = (path: string, theListAlone = runsTheListAlone) =>
  theListAlone && (path.startsWith("aot/") ? !everyBuild().has(path) : leftOutElsewhere().has(path));

let storedPrograms: string[] | undefined;
/** Whether CI leaves out the stored program at this path below `test/aot/parallel`. A line of its list is a program or the beginning of a path. */
export function isProgramLeftOut(path: string, theListAlone = runsTheListAlone): boolean {
  if (!theListAlone) return false;
  storedPrograms ??= linesOf("parallel", "every-build.txt");
  return !storedPrograms.some(line => path.startsWith(line));
}

/** The path of the test file that is being loaded, if it is left out. One process may load many, and loads this file once. */
export function leftOutHere(): string | undefined {
  if (!runsTheListAlone) return;
  const path = relative(join(import.meta.dir, "..", ".."), Bun.main).replaceAll("\\", "/");
  return isLeftOut(path) ? path : undefined;
}
