/**
 * Zstandard's decoder, in C, for one program that is not bun: the `jsc` shell
 * of a WebKit that is built here (`--webkit=local`) with the ICU of a prebuilt
 * one (`BUN_ICU_ROOT`). The data of that ICU has a zstd frame an item, and
 * WebKit's jsc.cpp reads them with this library, as in WebKit's own build
 * (shell/CMakeLists.txt, BUN_ICU_ZSTD_SOURCE_DIR).
 *
 * No other build fetches or compiles it, and it is one of `programDeps`, not of
 * `allDeps`: nothing of it reaches bun, whose zstd is src/zstd.
 */

import type { Dependency } from "../source.ts";
import { linuxIcuRoot } from "./webkit.ts";

const ZSTD_COMMIT = "f8745da6ff1ad1e7bab384bd1f9d742439278e99";

// prettier-ignore
const SOURCES = [
  "common/debug", "common/entropy_common", "common/error_private",
  "common/fse_decompress", "common/pool", "common/threading", "common/xxhash",
  "common/zstd_common",
  "decompress/huf_decompress", "decompress/zstd_ddict",
  "decompress/zstd_decompress", "decompress/zstd_decompress_block",
].map(s => `lib/${s}.c`);

export const zstd: Dependency = {
  name: "zstd",

  enabled: cfg => cfg.webkit === "local" && linuxIcuRoot(cfg) !== undefined,

  source: () => ({
    kind: "github-archive",
    repo: "facebook/zstd",
    commit: ZSTD_COMMIT,
  }),

  build: cfg => ({
    kind: "direct",
    // The Huffman kernel for amd64 is a .S file that clang assembles.
    sources: [...SOURCES, ...(cfg.x64 ? ["lib/decompress/huf_decompress_amd64.S"] : [])],
    defines: { ZSTD_LEGACY_SUPPORT: 0, ...(!cfg.x64 && { ZSTD_DISABLE_ASM: 1 }) },
    includes: ["lib", "lib/common"],
    pic: true,
    // A bare token that xxhash pastes onto its names: `defines` would quote it.
    cflags: ["-DXXH_NAMESPACE=ZSTD_"],
  }),

  provides: () => ({
    libs: [],
    includes: [],
  }),
};
