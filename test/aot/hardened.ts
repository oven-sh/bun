// test/harness.ts imports this file, so it takes nothing from there.
import { closeSync, openSync, readSync } from "node:fs";

function isPositionIndependent(path: string) {
  const header = Buffer.alloc(18);
  const descriptor = openSync(path, "r");
  try {
    readSync(descriptor, header, 0, header.length, 0);
  } finally {
    closeSync(descriptor);
  }
  return header.readUInt16LE(16) === 3;
}

/** Whether the Bun under test was built with `--hardened=on`. */
export const isHardened = process.platform === "linux" && isPositionIndependent(process.execPath);

/**
 * Whether it was built without `--lock-environment=off` too. An executable that such a build compiles ahead of time does
 * not start where the environment sets a variable that the build never reads.
 */
export const locksEnvironment =
  isHardened &&
  Bun.spawnSync(["grep", "-q", "-a", "hardened environment: what only tests set is never read", process.execPath])
    .exitCode === 0;

/** Whether it was built without `--guarded-pages=off` too. */
export const hasGuardedPages =
  isHardened &&
  Bun.spawnSync([
    "grep",
    "-q",
    "-a",
    "guarded pages: what a compiled program maps for good has an address of its own",
    process.execPath,
  ]).exitCode === 0;
