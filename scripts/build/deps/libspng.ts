/**
 * libspng — simple, fast PNG codec. Backs Bun.Image PNG decode/encode.
 *
 * Single-TU library; the only external dep is zlib for the deflate stream.
 * We point it at our vendored zlib-ng (ZLIB_COMPAT) via fetchDeps so the
 * generated zlib.h is in place before this compiles.
 *
 * SPNG_STATIC drops the dllexport/visibility decoration; SPNG_SSE controls
 * the x86 filter SIMD level (1=SSE2, baseline on every x64 we ship).
 */

import type { Dependency } from "../source.ts";
import { depBuildDir } from "../source.ts";

const LIBSPNG_COMMIT = "fb768002d4288590083a476af628e51c3f1d47cd"; // v0.7.4

export const libspng: Dependency = {
  name: "libspng",
  versionMacro: "LIBSPNG",

  source: () => ({
    kind: "github-archive",
    repo: "randy408/libspng",
    commit: LIBSPNG_COMMIT,
  }),

  // spng.c includes <zlib.h>; zlib-ng generates that header into its build
  // dir during its own configure, so we need zlib BUILT (not just fetched).
  fetchDeps: ["zlib"],

  build: cfg => ({
    kind: "direct",
    sources: ["spng/spng.c"],
    includes: ["spng"],
    defines: {
      SPNG_STATIC: true,
      // 1 = SSE2. spng's defilter SIMD is gated on __SSE2__ anyway, so this
      // is a no-op on arm64 (the #if falls through to scalar).
      ...(cfg.x64 ? { SPNG_SSE: 1 } : {}),
    },
    cflags: [`-I${depBuildDir(cfg, "zlib")}`],
  }),

  provides: () => ({
    libs: [],
    includes: ["spng"],
  }),
};
