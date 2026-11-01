// CI tests every build of Bun, whoever changed whatever, and all the test files of this folder together take fifteen hours of one processor. So CI runs the
// files that ../every-build.txt names, which together may cost what ../every-build.test.ts says. All of them run on the benches behind every build of the compiler.
//
// AOT_WHOLE=1: everything: every file, every case of a grid, in every way (./ways.ts). A build of CI whose message holds `[aot whole]` is one.
// AOT_WHOLE=0: what CI runs. A file that the list lacks declares one skipped test and does nothing else.
// Neither, outside CI: a file that is named runs, with the cases that it would run in CI.
//
// ./capabilities.ts turns what CI says into AOT_WHOLE, so that whatever is started from here reads the same.
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import "./capabilities";

export const runsWhole = process.env.AOT_WHOLE === "1";
export const runsTheListAlone = process.env.AOT_WHOLE === "0";

/** Seconds of processor time of a release on Linux x64, by the path below `test`, with `/`. */
export const everyBuild = new Map(
  readFileSync(join(import.meta.dir, "..", "every-build.txt"), "utf8")
    .split("\n")
    .filter(line => line && !line.startsWith("#"))
    .map(line => [line.slice(line.indexOf(" ") + 1), Number(line.slice(0, line.indexOf(" ")))] as const),
);

export const isLeftOut = (path: string, theListAlone = runsTheListAlone) => theListAlone && !everyBuild.has(path);

/** The path of the test file that is being loaded, if it is left out. One process may load many, and loads this file once. */
export function leftOutHere(): string | undefined {
  const path = relative(join(import.meta.dir, "..", ".."), Bun.main).replaceAll("\\", "/");
  // What a test writes into a temporary folder and starts is a part of that test, and inherits AOT_WHOLE.
  return !path.startsWith("../") && !isAbsolute(path) && isLeftOut(path) ? path : undefined;
}
