/**
 * ls-hpack — HPACK header compression for HTTP/2. Litespeed's implementation;
 * faster than nghttp2's for our workloads.
 *
 * DirectBuild: two .c files (lshpack + its bundled xxhash). The cmake build's
 * Debug config added `-fsanitize=address` without linking the runtime, which
 * forced us to pin buildType:Release; with DirectBuild that workaround is
 * gone — we control the flags ourselves.
 */

import type { Dependency, DirectBuild } from "../source.ts";

const LSHPACK_COMMIT = "8905c024b6d052f083a3d11d0a169b3c2735c8a1";

export const lshpack: Dependency = {
  name: "lshpack",
  versionMacro: "LSHPACK",

  source: () => ({
    kind: "github-archive",
    repo: "litespeedtech/ls-hpack",
    commit: LSHPACK_COMMIT,
  }),

  build: cfg => {
    const spec: DirectBuild = {
      kind: "direct",
      sources: ["lshpack.c", "deps/xxhash/xxhash.c"],
      includes: cfg.windows ? [".", "deps/xxhash", "compat/queue", "compat/windows"] : [".", "deps/xxhash"],
      defines: { XXH_HEADER_NAME: "xxhash.h" },
    };
    if (cfg.windows) spec.cflags = ["-w"];
    return spec;
  },

  provides: cfg => ({
    libs: [],
    // Windows needs compat/queue for <sys/queue.h> shim (LIST_HEAD/etc. macros
    // that don't exist on win32). On unix the real sys/queue.h is used.
    includes: cfg.windows ? [".", "compat/queue"] : ["."],
  }),
};
