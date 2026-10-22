import { bunExe, isLinux } from "harness";
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
export const isHardened = isLinux && isPositionIndependent(bunExe());
