// Whether node-gyp finds the headers of the pinned Node.js in its cache, or downloads them from
// nodejs.org. The `nodejs` tool of scripts/build/ci-images/spec.ts bakes that cache into CI's Linux
// and Windows images, and scripts/runner.node.ts asks here before it runs a test.

import { existsSync, readFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { pins } from "./build/ci-images/spec.ts";

/**
 * Where node-gyp keeps the pinned Node.js when nothing tells it otherwise: what its env-paths
 * dependency makes of the home and the environment of the process that runs it.
 */
export function nodeGypCacheDirectory(machine: {
  isWindows: boolean;
  homedir: string;
  env: { LOCALAPPDATA?: string | undefined; XDG_CACHE_HOME?: string | undefined };
}): string {
  const { isWindows, homedir, env } = machine;
  const { version } = pins.nodejs;
  return isWindows
    ? win32.join(env.LOCALAPPDATA || win32.join(homedir, "AppData", "Local"), "node-gyp", "Cache", version)
    : posix.join(env.XDG_CACHE_HOME || posix.join(homedir, ".cache"), "node-gyp", version);
}

/**
 * What a bake puts in `directory` and is not there. node-gyp downloads everything again when
 * `installVersion` is lower than its own, and on Windows when `<arch>/node.lib` is missing.
 */
export function nodeGypCacheProblems(directory: string, machine: { isWindows: boolean; arch: string }): string[] {
  const { nodeGypInstallVersion } = pins.nodejs;
  const problems: string[] = [];
  const installVersionPath = join(directory, "installVersion");
  if (!existsSync(installVersionPath)) {
    problems.push("installVersion is missing");
  } else {
    // node-gyp reads it with parseInt.
    const installVersion = parseInt(readFileSync(installVersionPath, "ascii"), 10);
    if (installVersion !== parseInt(nodeGypInstallVersion, 10)) {
      problems.push(`installVersion is ${installVersion}, the bake writes ${nodeGypInstallVersion}`);
    }
  }
  for (const file of ["include/node/node_api.h", ...(machine.isWindows ? [`${machine.arch}/node.lib`] : [])]) {
    if (!existsSync(join(directory, file))) {
      problems.push(`${file} is missing`);
    }
  }
  return problems;
}
