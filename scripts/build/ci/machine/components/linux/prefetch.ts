// Warm the build caches into a linux CI image:
//   - a read-only download cache for scripts/build/download.ts
//     (BUN_BUILD_PREFETCH_DIR), from a shallow clone of the bootstrapping
//     ref (the dep version pins live in that ref, not in this file);
//   - pre-pulled test docker images;
//   - a shared `bun install` download cache (BUN_INSTALL_CACHE_DIR).
// Everything cached is content-addressed by URL/identity, so a dep bump
// after the bake just misses the cache for that one dep — no re-bake. Every
// sub-step is best-effort: a missing fork ref or a network blip skips the
// cache instead of failing the bake. The windows half is windows/prefetch.ts.

import { join } from "node:path";
import { enableService, ensureDirectory, removePaths, setModeRecursive, setOwnerRecursive } from "../../ops-posix.ts";
import { ensureLines, log, mode, run, scratchDir, sudo, warn, which } from "../../runtime.ts";
import type { LinuxComponent } from "../component.ts";
import { appendToProfiles } from "../environment.ts";
import { linuxBin } from "../paths.ts";
import { REPO_URL, warmInstallCache } from "../prefetch-shared.ts";

export const prefetch: LinuxComponent = {
  name: "prefetch",
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

          // Read-only download cache — warmed only when the image declares
          // one (null = warm none). resolveConfig() walks up from cwd to
          // find package.json, so run from inside the clone.
          const prefetchDir = image.paths.caches.prefetch;
          if (prefetchDir === null) {
            log("no caches.prefetch on this image; not warming a prefetch cache");
          } else {
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
          }

          // Pre-pull test docker images (postgres, mysql, redis, minio, …) on
          // images that have docker (the build host does; runs as root
          // since our user's docker-group membership doesn't apply to the
          // current shell). prepare-ci.ts is checked into git on this ref.
          const haveDocker = which("docker") !== undefined || mode.dryRun;
          if (haveDocker) {
            await enableService("docker", { start: true });
            const pulled = await sudo([bun, "test/docker/prepare-ci.ts"], { cwd: clone, allowFailure: true });
            if (pulled.exitCode !== 0) warn("prepare-ci.ts failed; test docker images not pre-pulled");
          } else {
            log("skipping docker image pre-pull (no docker on this image)");
          }

          // Shared `bun install` download cache: every test shard's `bun
          // install` (root + test/) hits disk instead of npm. Left writable
          // and owned by the buildkite user: bun install extracts new
          // tarballs into the cache dir itself, so a read-only cache would
          // fail on the first unseen package. Warmed only when the image
          // declares a caches.install path (null = this image warms none).
          const cacheDir = image.paths.caches.install;
          if (cacheDir === null) {
            log("no caches.install on this image; not warming a bun install cache");
          } else {
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
          }
          await removePaths(clone);
        },
      },
    ];
  },
};
