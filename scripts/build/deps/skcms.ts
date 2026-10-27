/**
 * skcms — Skia's ICC parser and colour transform. libjxl's encoder needs a
 * CMS to read an embedded ICC profile and convert non-sRGB input to XYB, and
 * skcms is the smaller of the two it supports (the other is lcms2).
 *
 * Baseline transform only. The AVX2/AVX-512 variants (src/skcms_Transform
 * {Hsw,Skx}.cc) are what upstream's cmake adds on x64 clang, but skcms runs
 * once per lossy encode of a non-sRGB image, never in a per-pixel hot path
 * of Bun's own, so they're disabled rather than given per-file -m flags.
 */

import type { Dependency } from "../source.ts";

// The commit libjxl v0.12.0 pins as its third_party/skcms submodule.
const SKCMS_COMMIT = "96d9171c94b937a1b5f0293de7309ac16311b722";

export const skcms: Dependency = {
  name: "skcms",

  source: () => ({
    kind: "github-archive",
    repo: "google/skcms",
    commit: SKCMS_COMMIT,
  }),

  build: () => ({
    kind: "direct",
    lang: "cxx",
    sources: ["skcms.cc", "src/skcms_TransformBaseline.cc"],
    includes: ["."],
    defines: { SKCMS_DISABLE_HSW: true, SKCMS_DISABLE_SKX: true },
  }),

  provides: () => ({
    libs: [],
    includes: ["."],
  }),
};
