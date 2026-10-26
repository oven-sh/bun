/**
 * HdrHistogram_c — high-dynamic-range latency histogram. Used by bun test's
 * per-test timing output and benchmark reporting.
 *
 * DirectBuild: 3 .c files, no config.h. Only the in-memory histogram API is
 * used (JSNodePerformanceHooksHistogram.cpp), so the interval-recorder/
 * thread/time/phaser modules are omitted; the log writer (which would pull
 * in zlib) is replaced by hdr_histogram_log_no_op.c.
 */

import type { Dependency } from "../source.ts";

const HDRHISTOGRAM_COMMIT = "30e9ce6ef5dcdc60f9270e1ca03c0966eaaf71d0";

export const hdrhistogram: Dependency = {
  name: "hdrhistogram",

  source: () => ({
    kind: "github-archive",
    repo: "HdrHistogram/HdrHistogram_c",
    commit: HDRHISTOGRAM_COMMIT,
  }),

  // no-avx2-dispatch: the percentile scan's AVX2 path is selected with
  // __builtin_cpu_supports(), which links compiler-rt's cpu-model constructor
  // (runs before main; not in clang-cl's default link). Gate it on a define.
  patches: ["patches/hdrhistogram/bitscan-type.patch", "patches/hdrhistogram/no-avx2-dispatch.patch"],

  build: cfg => ({
    kind: "direct",
    sources: ["src/hdr_encoding.c", "src/hdr_histogram.c", "src/hdr_histogram_log_no_op.c"],
    includes: ["include"],
    defines: {
      HDR_NO_AVX2_DISPATCH: true,
      ...(cfg.windows ? { _CRT_SECURE_NO_WARNINGS: true } : { _GNU_SOURCE: true }),
    },
  }),

  provides: () => ({
    libs: [],
    includes: ["include"],
  }),
};
