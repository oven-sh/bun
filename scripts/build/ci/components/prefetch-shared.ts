// Shared by prefetch.linux.ts and prefetch.windows.ts: the shallow clone
// URL and the `bun install` cache warm-up, which is identical on both.

import { join } from "node:path";
import { run } from "../bootstrap/runtime.ts";

export const REPO_URL = "https://github.com/oven-sh/bun.git";

/** `bun install --ignore-scripts` for the repo root and test/, both into
 * one cache dir. Returns false if either failed (best-effort). */
export async function warmInstallCache(bun: string, clone: string, cacheDir: string): Promise<boolean> {
  const rootInstall = await run([bun, "install", "--ignore-scripts"], {
    cwd: clone,
    env: { BUN_INSTALL_CACHE_DIR: cacheDir },
    allowFailure: true,
  });
  const testInstall = await run([bun, "install", "--ignore-scripts"], {
    cwd: join(clone, "test"),
    env: { BUN_INSTALL_CACHE_DIR: cacheDir },
    allowFailure: true,
  });
  return rootInstall.exitCode === 0 && testInstall.exitCode === 0;
}
