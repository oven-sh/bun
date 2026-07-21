// Warm the build caches into the image (CI-only, both platforms):
//   - a read-only download cache for scripts/build/download.ts
//     (BUN_BUILD_PREFETCH_DIR), from a shallow clone of the bootstrapping
//     ref (the dep version pins live in that ref, not in this file);
//   - pre-pulled test docker images (linux);
//   - a shared `bun install` download cache (BUN_INSTALL_CACHE_DIR).
// Everything cached is content-addressed by URL/identity, so a dep bump
// after the bake just misses the cache for that one dep — no re-bake. Every
// sub-step is best-effort: a fork branch missing on the upstream remote or a
// network blip skips the cache instead of failing the bake.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  enableService,
  ensureDirectory,
  removePaths,
  setModeRecursive,
  setOwnerRecursive,
} from "../bootstrap/ops-posix.ts";
import * as win from "../bootstrap/ops-windows.ts";
import { ensureLines, log, mode, run, scratchDir, sudo, warn, which } from "../bootstrap/runtime.ts";
import type { Component } from "./component.ts";
import { appendToProfiles } from "./environment.ts";
import { linuxBin } from "./paths.ts";

const REPO_URL = "https://github.com/oven-sh/bun.git";

export const prefetch: Component = {
  name: "prefetch",
  linux: {
    artifacts: () => ({}),
    steps: ctx => {
      const { image, repoRef, ci } = ctx;
      return [
        {
          name: "Warm the build prefetch cache and bun install cache",
          skip: !ci && "not a CI image",
          run: async () => {
            const bun = linuxBin(image, "bun");
            const clone = join(scratchDir, "bun-repo");
            const cloned = await run(["git", "clone", "--depth=1", "--branch", repoRef, REPO_URL, clone], {
              allowFailure: true,
            });
            if (cloned.exitCode !== 0) {
              warn(`clone of ref "${repoRef}" failed; baking without warm caches`);
              return;
            }
            if (!existsSync(join(clone, "scripts/prefetch-deps.ts")) && !mode.dryRun) {
              warn(`scripts/prefetch-deps.ts not present at ${repoRef}; skipping warm cache`);
              return;
            }

            // Read-only download cache. resolveConfig() walks up from cwd to
            // find package.json, so run from inside the clone.
            const prefetchDir = image.paths.prefetchDir;
            await ensureDirectory(prefetchDir, { mode: "777" });
            const prefetched = await run([bun, "scripts/prefetch-deps.ts", prefetchDir], {
              cwd: clone,
              allowFailure: true,
            });
            if (prefetched.exitCode !== 0) {
              warn("prefetch-deps.ts failed; baking without warm download cache");
              await removePaths(prefetchDir);
            } else {
              // Read-only: download.ts only ever copies FROM here, and a
              // writable baked input is something a misbehaving job could
              // corrupt for later jobs.
              await setModeRecursive(prefetchDir, "a-w");
              await ensureLines("/etc/environment", [`BUN_BUILD_PREFETCH_DIR=${prefetchDir}`]);
              await appendToProfiles(ctx, [`export BUN_BUILD_PREFETCH_DIR="${prefetchDir}"`]);
            }

            // Pre-pull test docker images (postgres, mysql, redis, minio, …).
            // Runs as root: our user is in the docker group but that doesn't
            // apply to the current shell.
            const havePrepare = existsSync(join(clone, "test/docker/prepare-ci.ts")) || mode.dryRun;
            const haveDocker = which("docker") !== undefined || mode.dryRun;
            if (havePrepare && haveDocker) {
              await enableService("docker", { start: true });
              const pulled = await sudo([bun, "test/docker/prepare-ci.ts"], { cwd: clone, allowFailure: true });
              if (pulled.exitCode !== 0) warn("prepare-ci.ts failed; test docker images not pre-pulled");
            } else {
              log("skipping docker image pre-pull (no prepare-ci.ts or no docker)");
            }

            // Shared `bun install` download cache: every test shard's `bun
            // install` (root + test/) hits disk instead of npm. Left writable
            // and owned by the buildkite user: bun install extracts new
            // tarballs into the cache dir itself, so a read-only cache would
            // fail on the first unseen package.
            const cacheDir = image.paths.installCacheDir;
            await ensureDirectory(cacheDir, { mode: "777" });
            const ok = await warmInstallCache(bun, clone, cacheDir);
            if (!ok) {
              warn("bun install prefetch failed; baking without warm install cache");
              await removePaths(cacheDir);
            } else {
              await setOwnerRecursive(cacheDir, `${image.paths.buildkiteUser}:${image.paths.buildkiteUser}`);
              await ensureLines("/etc/environment", [`BUN_INSTALL_CACHE_DIR=${cacheDir}`]);
              await appendToProfiles(ctx, [`export BUN_INSTALL_CACHE_DIR="${cacheDir}"`]);
            }
            await removePaths(clone);
          },
        },
      ];
    },
  },
  windows: {
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
            if (!existsSync(join(clone, "scripts", "prefetch-deps.ts")) && !mode.dryRun) {
              warn(`scripts/prefetch-deps.ts not present at ${repoRef}; skipping warm cache`);
              return;
            }
            const prefetchDir = image.paths.prefetchDir;
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
            // Shared `bun install` download cache. Left writable: bun install
            // extracts new tarballs into the cache dir itself. The agent runs
            // as SYSTEM, which can write here.
            const cacheDir = image.paths.installCacheDir;
            await win.ensureDirectory(cacheDir);
            const ok = await warmInstallCache("bun", clone, cacheDir);
            if (!ok) {
              warn("bun install prefetch failed; baking without warm install cache");
              await win.removePaths(cacheDir);
            } else {
              await win.setMachineEnv("BUN_INSTALL_CACHE_DIR", cacheDir);
            }
            // The installs leave ~2 GB of node_modules in the clone.
            await win.removeTreeRobustly(clone);
          },
        },
      ];
    },
  },
};

/** `bun install --ignore-scripts` for the repo root and test/, both into
 * one cache dir. Returns false if either failed (best-effort). */
async function warmInstallCache(bun: string, clone: string, cacheDir: string): Promise<boolean> {
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
