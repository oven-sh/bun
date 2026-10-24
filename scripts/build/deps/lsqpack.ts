/**
 * ls-qpack — QPACK header compression for HTTP/3. Litespeed's implementation.
 * Used by lsquic for HTTP/3 header encoding.
 *
 * Header-only here: lsqpack.c and its bundled xxhash are compiled by the lsquic
 * dep (see lsquic.ts).
 */

import type { Dependency, DirectBuild } from "../source.ts";

const LSQPACK_COMMIT = "91567706c41c0d97ab8dc576873ecd472d7869fa";

/**
 * The width of `name_len` and `val_len` in `struct lsxpack_header`, which
 * ls-qpack, lsquic and bun's own sources pass to each other. 16 bits by
 * default, which can't hold an HTTP/3 field of 64 KB. Everything that includes
 * lsxpack_header.h has to agree, so this is the only place that says it: lsquic
 * (which compiles lsqpack.c) spreads it into its defines, and `provides.defines`
 * below hands it to bun's sources, which static_assert it. packages/h3blast has
 * a Makefile of its own and repeats it.
 */
export const lsxpackDefines = { LSXPACK_MAX_STRLEN: 0xffff_ffff }; // UINT32_MAX. A string would be quoted.

export const lsqpack: Dependency = {
  name: "lsqpack",

  source: () => ({
    kind: "github-archive",
    repo: "litespeedtech/ls-qpack",
    commit: LSQPACK_COMMIT,
  }),

  patches: [
    // hencs[65536]/hdecs[65536] (768 KB of .rodata) are pure functions of the
    // 257-entry encode_table. Declare them in .bss and fill on first init
    // (~250 us once); the hot-path lookup is unchanged.
    "patches/lsqpack/bss-huff-tables.patch",
    // The decoder asks dhi_prepare_decode() for room for the bytes it has in
    // hand, so the buffer of a long name or value grows as it arrives.
    "patches/lsqpack/decode-room-for-bytes-in-hand.patch",
  ],

  // lsqpack.c is compiled inside the lsquic dep because lsquic feeds it a
  // non-FILE* logger context that only works with LSQPACK_*_LOGGER_HEADER
  // pointing at lsquic-internal headers. This dep just provides lsqpack.h.
  build: cfg => {
    void cfg;
    const spec: DirectBuild = { kind: "direct", sources: [] };
    return spec;
  },

  provides: cfg => ({
    libs: [],
    includes: cfg.windows ? [".", "wincompat"] : ["."],
    defines: Object.entries(lsxpackDefines).map(([name, value]) => `${name}=${value}`),
  }),
};
