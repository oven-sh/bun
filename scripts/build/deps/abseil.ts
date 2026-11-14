/**
 * Abseil — the hash tables and string formatting that Dawn and Tint use. The
 * commit is the one in Dawn's DEPS (dawn.ts). Only the files they reach are listed.
 */

import type { Dependency } from "../source.ts";
import { dawnCxxFlags } from "./dawn.ts";

const ABSEIL_COMMIT = "d9b93ccc244c39cb02fc9a3413dbeeed0ac95e70";

// prettier-ignore
const SOURCES = [
  "base/internal/raw_logging", "base/throw_delegate",
  "container/internal/raw_hash_set",
  "hash/internal/city", "hash/internal/hash",
  "numeric/int128",
  "strings/ascii", "strings/charconv", "strings/match", "strings/numbers",
  "strings/internal/charconv_bigint", "strings/internal/charconv_parse", "strings/internal/memutil",
  "strings/internal/utf8",
  "strings/internal/str_format/arg", "strings/internal/str_format/bind", "strings/internal/str_format/extension",
  "strings/internal/str_format/float_conversion", "strings/internal/str_format/output",
  "strings/internal/str_format/parser",
];

export const abseil: Dependency = {
  name: "abseil",

  source: () => ({
    kind: "github-archive",
    repo: "abseil/abseil-cpp",
    commit: ABSEIL_COMMIT,
  }),

  patches: ["patches/abseil/inline-unsampled-hashtablez.patch", "patches/abseil/no-iostream.patch"],

  build: cfg => ({
    kind: "direct",
    lang: "cxx",
    sources: SOURCES.map(file => `absl/${file}.cc`),
    includes: ["."],
    cflags: dawnCxxFlags(cfg),
  }),

  provides: () => ({ libs: [], includes: [] }),
};
