/**
 * Caches warmed from the commit being built, so CI jobs start with their
 * downloads done. What ends up in them depends on that commit (the vendored
 * dependency list, the test images, the lockfiles), which changes far more
 * often than an image should be rebaked, so their contents are deliberately
 * not part of the image's hash: only these scripts are.
 */

import type { LinuxImage, Tool } from "../image.ts";

/** `scripts/prefetch-deps.ts`: every dependency source and prebuilt the build downloads, read-only under `$BUN_BUILD_PREFETCH_DIR`. */
export function prefetchBuildDeps(directory: string): Tool {
  return {
    name: "prefetch-build-deps",
    script: "linux/prefetch-build-deps.sh",
    variables: { PREFETCH_DIR: directory },
  };
}

/** The database and service images the tests start, pulled and built into Docker's store. */
export function prefetchTestImages(image: LinuxImage): Tool {
  return {
    name: "prefetch-test-images",
    script:
      image.distro === "alpine" ? "linux/prefetch-test-images.openrc.sh" : "linux/prefetch-test-images.systemd.sh",
    variables: {},
  };
}

/** `bun install`'s cache for the repository's three package.json files, under `$BUN_INSTALL_CACHE_DIR`. */
export function prefetchInstallCache(): Tool {
  return { name: "prefetch-install-cache", script: "linux/prefetch-install-cache.sh", variables: {} };
}

/** Windows: the build dependencies and the install cache, from a clone of the commit being built. There is no Docker there. */
export function prefetchWindows(directory: string): Tool {
  return { name: "prefetch", script: "windows/prefetch.ps1", variables: { PREFETCH_DIR: directory } };
}
