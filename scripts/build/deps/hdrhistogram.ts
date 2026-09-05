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

const HDRHISTOGRAM_COMMIT = "18c7a324383dded1451d15621cd018b0048057d0";

export const hdrhistogram: Dependency = {
  name: "hdrhistogram",

  source: () => ({
    kind: "github-archive",
    repo: "HdrHistogram/HdrHistogram_c",
    commit: HDRHISTOGRAM_COMMIT,
  }),

  patches: ["patches/hdrhistogram/bitscan-type.patch"],

  build: cfg => ({
    kind: "direct",
    sources: ["src/hdr_encoding.c", "src/hdr_histogram.c", "src/hdr_histogram_log_no_op.c"],
    includes: ["include"],
    defines: cfg.windows ? { _CRT_SECURE_NO_WARNINGS: true } : { _GNU_SOURCE: true },
  }),

  provides: () => ({
    libs: [],
    includes: ["include"],
  }),
};
