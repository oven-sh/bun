// The tests run plain Bun without installing packages.
//
// `bun run` asks the registry for a package that a program imports and that is not installed, unless a folder above the
// program holds a node_modules folder. So the tests make their temporary folders in a folder that holds an empty one, and
// the stored programs lie below one too. It takes no flag: a program sees the arguments and the environment it would see anyway.
//
// test/harness.ts imports this file, so it takes nothing from there. A tool that does not import the harness imports this file,
// and calls `withoutInstallingPackages` for a folder that it makes anywhere else than in `tmpdir()`.
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Whether `bun run` leaves the registry alone for a program in `folder`. */
export function hasNodeModulesAbove(folder: string): boolean {
  for (let at = folder; ; at = dirname(at)) {
    if (existsSync(join(at, "node_modules"))) return true;
    if (at === dirname(at)) return false;
  }
}

/** Makes `folder`, and returns it. `bun run` leaves the registry alone for every program in it. */
export function withoutInstallingPackages(folder: string): string {
  mkdirSync(folder, { recursive: true });
  if (!hasNodeModulesAbove(folder)) mkdirSync(join(folder, "node_modules"), { recursive: true });
  return folder;
}

/** Where to make a temporary folder in which `bun run` does ask the registry. */
export function temporaryFolderThatInstalls(): string {
  const temporary = realpathSync.native(tmpdir());
  return existsSync(join(temporary, "node_modules")) ? dirname(temporary) : temporary;
}

try {
  const temporary = realpathSync(tmpdir());
  if (!hasNodeModulesAbove(temporary)) {
    const root = withoutInstallingPackages(join(temporary, `bun-tests-${process.getuid?.() ?? 0}`));
    for (const name of process.platform === "win32" ? ["TEMP", "TMP"] : ["TMPDIR"]) process.env[name] = root;
  }
} catch {
  // A fixture that imports the harness may be given a temporary directory that is missing or read-only.
}
try {
  withoutInstallingPackages(dirname(import.meta.dir));
} catch {
  // The sources cannot be written to here. plain-bun-installs-no-packages.test.ts says whether that matters.
}
