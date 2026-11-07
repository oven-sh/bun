// The tests run plain Bun without installing packages.
//
// `bun run` asks the registry for a package that a program imports and that is not installed, unless a folder above the
// program holds a node_modules folder. So these tests make their temporary folders in a folder that holds an empty one, and
// the stored programs lie below one too. It takes no flag: a program sees the arguments and the environment it would see anyway.
//
// test/harness.ts imports this file, so it takes nothing from there. A tool that does not import the harness imports this file,
// and calls `withoutInstallingPackages` for a folder that it makes anywhere else than in `tmpdir()`.
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
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

/** Whether `main`, the file that Bun was started with, is one of the tests and tools that this file is for. */
export function covers(main: string): boolean {
  if (/[\\/]test[\\/](aot[\\/]|cli[\\/]compile[\\/]|.*(aot|trim)[^\\/]*$)/.test(main)) return true;
  if (!/[\\/]test[\\/]/.test(main)) return false;
  try {
    return /--(debug-)?aot\b|--trim\b|\b(aot|trim): true\b/.test(readFileSync(main, "utf8"));
  } catch {
    return false;
  }
}

if (covers(Bun.main)) {
  const temporary = realpathSync(tmpdir());
  if (!hasNodeModulesAbove(temporary)) {
    const root = withoutInstallingPackages(join(temporary, "aot"));
    for (const name of process.platform === "win32" ? ["TEMP", "TMP"] : ["TMPDIR"]) process.env[name] = root;
  }
  try {
    withoutInstallingPackages(dirname(import.meta.dir));
  } catch {
    // The sources cannot be written to here. plain-bun-installs-no-packages.test.ts says whether that matters.
  }
}
