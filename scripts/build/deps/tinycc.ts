/**
 * TinyCC — small embeddable C compiler. Powers bun:ffi's JIT-compile path,
 * where user-provided C gets compiled and linked at runtime.
 *
 * Disabled on windows-arm64 (tinycc doesn't have an arm64-coff backend).
 */

import type { Dependency, NestedCmakeBuild } from "../source.ts";

const TINYCC_COMMIT = "12882eee073cfe5c7621bcfadf679e1372d4537b";

export const tinycc: Dependency = {
  name: "tinycc",
  versionMacro: "TINYCC",

  // The cfg.tinycc flag already encodes the windows-arm64 exclusion
  // (see config.ts: `tinycc ?? !(windows && arm64)`).
  enabled: cfg => cfg.tinycc,

  source: () => ({
    kind: "github-archive",
    repo: "oven-sh/tinycc",
    commit: TINYCC_COMMIT,
  }),

  // Our tinycc fork has no CMakeLists.txt — it uses a configure script. We
  // inject one as an overlay file. (The proper fix is to commit this upstream
  // to oven-sh/tinycc; see TODO in patches/tinycc/CMakeLists.txt.)
  patches: ["patches/tinycc/CMakeLists.txt", "patches/tinycc/tcc.h.patch"],

  build: cfg => {
    const spec: NestedCmakeBuild = {
      kind: "nested-cmake",
      args: {},
    };
    // clang-cl is noisy about tinycc's old-C idioms (implicit int conversions,
    // enum coercions). The code is correct; silence it.
    if (cfg.windows) {
      spec.extraCFlags = ["-w"];
    }
    return spec;
  },

  provides: () => ({
    libs: ["tcc"],
    includes: [],
  }),
};
