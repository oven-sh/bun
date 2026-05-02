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

  // hencs[65536]/hdecs[65536] (768 KB of .rodata) are pure functions of the
  // 257-entry encode_table. Declare them in .bss and fill on first init
  // (~250 us once); the hot-path lookup is unchanged.
  patches: ["patches/lshpack/bss-huff-tables.patch"],

  build: cfg => {
    // <sys/queue.h> ships with glibc and BSD libc but not musl or win32.
    // lshpack vendors a copy under compat/queue/ for that case.
    const needCompatQueue = cfg.windows || cfg.abi === "musl";
    const spec: DirectBuild = {
      kind: "direct",
      sources: ["lshpack.c", "deps/xxhash/xxhash.c"],
      includes: [
        ".",
        "deps/xxhash",
        ...(needCompatQueue ? ["compat/queue"] : []),
        ...(cfg.windows ? ["compat/windows"] : []),
      ],
      defines: {
        XXH_HEADER_NAME: "xxhash.h",
        // lshpack.c defaults LS_HPACK_USE_LARGE_TABLES=1 internally; setting
        // it here is purely defensive so the bss-huff-tables patch can't be
        // silently disabled by a future upstream change to the default.
        LS_HPACK_USE_LARGE_TABLES: 1,
        LS_HPACK_BSS_LARGE_TABLES: 1,
      },
    };
    if (cfg.windows) spec.cflags = ["-w"];
    return spec;
  },

  provides: cfg => ({
    libs: [],
    includes: cfg.windows || cfg.abi === "musl" ? [".", "compat/queue"] : ["."],
  }),
};
