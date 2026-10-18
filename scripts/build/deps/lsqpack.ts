/**
 * ls-qpack — QPACK header compression for HTTP/3. Litespeed's implementation,
 * sibling to ls-hpack. Used by lsquic for HTTP/3 header encoding.
 *
 * Header-only here: lsqpack.c is compiled by the lsquic dep (see lsquic.ts).
 */

import type { Dependency, DirectBuild } from "../source.ts";

const LSQPACK_COMMIT = "91567706c41c0d97ab8dc576873ecd472d7869fa";

export const lsqpack: Dependency = {
  name: "lsqpack",

  source: () => ({
    kind: "github-archive",
    repo: "litespeedtech/ls-qpack",
    commit: LSQPACK_COMMIT,
  }),

  patches: [
    // QPACK uses the same RFC 7541 Huffman code as HPACK; share lshpack's
    // .bss-backed hencs/hdecs instead of carrying a second 768 KB copy.
    "patches/lsqpack/bss-huff-tables.patch",
    // The decoder failed a field section that is only its prefix, with no
    // field lines. RFC 9204 Section 4.5 allows one, and the encoder writes
    // one for an empty header list, such as a trailer section that the
    // application left empty. lsquic answers a decoder failure by closing the
    // connection, which ends every other request on it. Not fixed upstream:
    // https://github.com/litespeedtech/ls-qpack/issues/90#issuecomment-5472689782
    "patches/lsqpack/accept-empty-field-section.patch",
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
  }),
};
