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

const LSHPACK_COMMIT = "cf0f70dd10b352194c97448eb5d00b4aa484f531";

/**
 * The width of `name_len` and `val_len` in `struct lsxpack_header`, which
 * ls-hpack, ls-qpack, lsquic and bun's own sources pass to each other. 16 bits
 * by default, which can't hold an HTTP/3 field of 64 KB. Everything that
 * includes lsxpack_header.h has to agree, so this is the only place that says
 * it: lshpack and lsquic (which compiles lsqpack.c) spread it into their
 * defines, and `provides.defines` below hands it to bun's sources, which
 * static_assert it. packages/h3blast has a Makefile of its own and repeats it.
 */
export const lsxpackDefines = { LSXPACK_MAX_STRLEN: 0xffff_ffff }; // UINT32_MAX. A string would be quoted.

export const lshpack: Dependency = {
  name: "lshpack",
  versionMacro: "LSHPACK",

  source: () => ({
    kind: "github-archive",
    repo: "litespeedtech/ls-hpack",
    commit: LSHPACK_COMMIT,
  }),

  // hencs[65536]/hdecs[65536] (768 KB of .rodata) are pure functions of the
  // 257-entry encode_table. Build them at the first init (~250 us once) in
  // memory allocated then; the hot-path lookup is unchanged. They are not
  // zero-filled data of the executable (.bss): that has to stay smaller than a
  // transparent huge page (test/internal/zero-filled-data-below-a-huge-page.test.ts).
  patches: ["patches/lshpack/lazy-huff-tables.patch"],

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
        ...lsxpackDefines,
        XXH_HEADER_NAME: "xxhash.h",
        // lshpack.c defaults LS_HPACK_USE_LARGE_TABLES=1 internally; setting
        // it here is purely defensive so the lazy-huff-tables patch can't be
        // silently disabled by a future upstream change to the default.
        LS_HPACK_USE_LARGE_TABLES: 1,
        LS_HPACK_LAZY_LARGE_TABLES: 1,
      },
    };
    // The patch reports a failed allocation of the tables through this function.
    // The value is a function name, and a `defines` entry would quote it.
    spec.cflags = ["-DLS_HPACK_OOM=Bun__outOfMemory", ...(cfg.windows ? ["-w"] : [])];
    return spec;
  },

  provides: cfg => ({
    libs: [],
    includes: cfg.windows || cfg.abi === "musl" ? [".", "compat/queue"] : ["."],
    defines: Object.entries(lsxpackDefines).map(([name, value]) => `${name}=${value}`),
  }),
};
