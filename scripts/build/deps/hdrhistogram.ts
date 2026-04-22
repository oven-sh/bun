/**
 * HdrHistogram_c — high-dynamic-range latency histogram. Used by bun test's
 * per-test timing output and benchmark reporting.
 *
 * DirectBuild: 7 .c files, no config.h. The log writer (which would pull in
 * zlib) is replaced by hdr_histogram_log_no_op.c — we only need the in-memory
 * histogram API.
 */

import type { Dependency } from "../source.ts";

const HDRHISTOGRAM_COMMIT = "be60a9987ee48d0abf0d7b6a175bad8d6c1585d1";

export const hdrhistogram: Dependency = {
  name: "hdrhistogram",

  source: () => ({
    kind: "github-archive",
    repo: "HdrHistogram/HdrHistogram_c",
    commit: HDRHISTOGRAM_COMMIT,
  }),

  build: cfg => ({
    kind: "direct",
    sources: [
      "src/hdr_encoding.c",
      "src/hdr_histogram.c",
      "src/hdr_histogram_log_no_op.c",
      "src/hdr_interval_recorder.c",
      "src/hdr_thread.c",
      "src/hdr_time.c",
      "src/hdr_writer_reader_phaser.c",
    ],
    includes: ["include"],
    ...(!cfg.windows && { defines: { _GNU_SOURCE: true } }),
  }),

  provides: () => ({
    libs: [],
    includes: ["include"],
  }),
};
