/**
 * ls-qpack — QPACK header compression for HTTP/3. Litespeed's implementation,
 * sibling to ls-hpack. Used by lsquic for HTTP/3 header encoding.
 *
 * Header-only here: lsqpack.c is compiled by the lsquic dep (see lsquic.ts).
 */

import type { Dependency, DirectBuild } from "../source.ts";

const LSQPACK_COMMIT = "1e9c5b8e59f8161c54f168a570c8bfdc59ded0c3";

export const lsqpack: Dependency = {
  name: "lsqpack",
  versionMacro: "LSQPACK",

  source: () => ({
    kind: "github-archive",
    repo: "litespeedtech/ls-qpack",
    commit: LSQPACK_COMMIT,
  }),

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
