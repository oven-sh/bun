// Warm the build caches into a windows CI image: the read-only download
// cache (BUN_BUILD_PREFETCH_DIR) and the shared `bun install` cache
// (BUN_INSTALL_CACHE_DIR), from a shallow clone of the bootstrapping ref.
// Best-effort: a failed clone or install skips the cache instead of failing
// the bake. The linux half is components/linux/prefetch.ts.

import { join } from "node:path";
import * as win from "../../ops-windows.ts";
import { log, run, scratchDir, warn } from "../../runtime.ts";
import type { WindowsComponent } from "../component.ts";
import { REPO_URL, warmInstallCache } from "../prefetch-shared.ts";

export const prefetch: WindowsComponent = {
  name: "prefetch",
  artifacts: () => ({}),
  steps: ctx => {
    const { image, repoRef, ci } = ctx;
    return [
      {
        name: "Warm the build prefetch cache and bun install cache",
        skip: !ci && "not a CI image",
        run: async () => {
          const clone = join(scratchDir, "bun-repo");
          const cloned = await run(["git", "clone", "--depth=1", "--branch", repoRef, REPO_URL, clone], {
            allowFailure: true,
          });
          if (cloned.exitCode !== 0) {
            warn(`clone of ref "${repoRef}" failed; baking without warm caches`);
            return;
          }
          const prefetchDir = image.paths.caches.prefetch;
          if (prefetchDir === null) {
            log("no caches.prefetch on this image; not warming a prefetch cache");
          } else {
            await win.ensureDirectory(prefetchDir);
            // resolveConfig() walks up from cwd to find package.json — run
            // from inside the clone.
            const prefetched = await run(["bun", "scripts\\prefetch-deps.ts", prefetchDir], {
              cwd: clone,
              allowFailure: true,
            });
            if (prefetched.exitCode !== 0) {
              warn("prefetch-deps.ts failed; baking without warm download cache");
              await win.removePaths(prefetchDir);
            } else {
              // Read-only: download.ts only ever copies FROM here.
              await win.makeReadOnlyRecursive(prefetchDir);
              await win.setMachineEnv("BUN_BUILD_PREFETCH_DIR", prefetchDir);
            }
          }
          // Shared `bun install` download cache. Left writable: bun install
          // extracts new tarballs into the cache dir itself. The agent runs as
          // SYSTEM, which can write here. Warmed only when the image declares
          // a caches.install path (null = warm none).
          const cacheDir = image.paths.caches.install;
          if (cacheDir === null) {
            log("no caches.install on this image; not warming a bun install cache");
          } else {
            await win.ensureDirectory(cacheDir);
            const ok = await warmInstallCache("bun", clone, cacheDir);
            if (!ok) {
              warn("bun install prefetch failed; baking without warm install cache");
              await win.removePaths(cacheDir);
            } else {
              await win.setMachineEnv("BUN_INSTALL_CACHE_DIR", cacheDir);
            }
          }
          // The installs leave ~2 GB of node_modules in the clone.
          await win.removeTreeRobustly(clone);
        },
      },
    ];
  },
};
