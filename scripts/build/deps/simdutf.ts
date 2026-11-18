/**
 * simdutf — Unicode validation, transcoding and base64 with runtime dispatch.
 *
 * `src/simdutf.cpp` is its unity TU: it includes every kernel and selects the
 * ISA of each with target attributes, so no per-file `-m` flags are needed.
 */

import type { Dependency } from "../source.ts";

const SIMDUTF_COMMIT = "358e33c97848dda568c5b113e1be6acb8d63dfb9"; // v9.4.0

// Nothing calls these, but the table of virtual functions of each ISA would keep them in the executable.
// src/engine/standalone/build.rs reads this line.
export const unusedFeatures = ["SIMDUTF_FEATURE_UTF32", "SIMDUTF_FEATURE_DETECT_ENCODING"];

export const simdutf: Dependency = {
  name: "simdutf",

  source: () => ({
    kind: "github-archive",
    repo: "simdutf/simdutf",
    commit: SIMDUTF_COMMIT,
  }),

  build: cfg => ({
    kind: "direct",
    lang: "cxx",
    pic: true,
    sources: ["src/simdutf.cpp"],
    includes: ["include", "src"],
    defines: Object.fromEntries(unusedFeatures.map(feature => [feature, 0])),
    cflags: [cfg.windows ? "/clang:-std=c++20" : "-std=c++20"],
  }),

  provides: () => ({
    libs: [],
    includes: ["include"],
    defines: unusedFeatures.map(feature => `${feature}=0`),
  }),
};
