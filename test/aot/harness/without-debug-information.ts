import { bunExe, isASAN, isLinux } from "harness";
import { existsSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every build writes the Bun that runs it once more, and CI tests bun-profile, which on Linux has its debug information in it:
// three times the bytes of the Bun that ships. A file of many builds makes them of a copy without it. The copy lies in the
// temporary directory under a name that tells this Bun from any other. It is made once and found again by every test file,
// process and run, so no test removes it; whoever makes one removes those that nobody has used for a day.
function findCopy(): string | undefined {
  const strip = isLinux && Bun.which("strip");
  const { ino, size, mtimeMs } = statSync(bunExe());
  if (!strip || size < 200 * 1024 * 1024) return undefined;
  const prefix = "bun-without-debug-information-";
  const copy = join(tmpdir(), `${prefix}${ino}-${size}-${Math.trunc(mtimeMs)}`);
  if (existsSync(copy)) {
    utimesSync(copy, new Date(), new Date());
    return copy;
  }
  for (const name of readdirSync(tmpdir())) {
    if (
      name.startsWith(prefix) &&
      Date.now() - (statSync(join(tmpdir(), name), { throwIfNoEntry: false })?.mtimeMs ?? Infinity) >
        24 * 60 * 60 * 1000
    )
      rmSync(join(tmpdir(), name), { force: true });
  }
  const unfinished = `${copy}.${process.pid}`;
  // LeakSanitizer's suppressions (test/leaksan.supp) name functions, so under it the copy keeps its table of symbols.
  const removed = isASAN ? ["--strip-debug"] : [];
  if (
    Bun.spawnSync({ cmd: [strip, ...removed, "-o", unfinished, bunExe()], stdout: "ignore", stderr: "ignore" })
      .exitCode !== 0
  ) {
    rmSync(unfinished, { force: true });
    return undefined;
  }
  renameSync(unfinished, copy);
  return copy;
}

/** The path of this Bun without its debug information. Undefined where it has none. */
export const copyWithoutDebugInformation: string | undefined = findCopy();

/** The flags with which a build makes its executable of that copy. */
export const withoutDebugInformation: string[] = copyWithoutDebugInformation
  ? ["--compile-executable-path", copyWithoutDebugInformation]
  : [];
