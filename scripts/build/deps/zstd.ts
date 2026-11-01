/**
 * Zstandard — fast compression with a good ratio/speed tradeoff. Backs
 * bun's install cache and the `zstd` Content-Encoding in fetch.
 *
 * DirectBuild: globbed common/compress/decompress/dictBuilder. Legacy-format
 * decoders (zstd v0.5-v0.7, pre-1.0) are NOT built — Bun never reads
 * pre-1.0 frames (install cache, fetch Content-Encoding, and Bun.zstd all
 * use the current format). The amd64
 * Huffman kernel ships as a .S file that clang assembles directly; on other
 * targets ZSTD_DISABLE_ASM falls through to the C implementation.
 */

import { join } from "node:path";
import type { Config } from "../config.ts";
import { type Dependency, type DirectBuild, depBuildDir, depSourceDir } from "../source.ts";

const ZSTD_COMMIT = "f8745da6ff1ad1e7bab384bd1f9d742439278e99";

// prettier-ignore
const SOURCES = [
  "common/debug", "common/entropy_common", "common/error_private",
  "common/fse_decompress", "common/pool", "common/threading", "common/xxhash",
  "common/zstd_common",
  "compress/fse_compress", "compress/hist", "compress/huf_compress",
  "compress/zstd_compress", "compress/zstd_compress_literals",
  "compress/zstd_compress_sequences", "compress/zstd_compress_superblock",
  "compress/zstd_double_fast", "compress/zstd_fast", "compress/zstd_lazy",
  "compress/zstd_ldm", "compress/zstd_opt", "compress/zstd_preSplit",
  "compress/zstdmt_compress",
  "decompress/huf_decompress", "decompress/zstd_ddict",
  "decompress/zstd_decompress", "decompress/zstd_decompress_block",
  "dictBuilder/cover", "dictBuilder/divsufsort", "dictBuilder/fastcover",
  "dictBuilder/zdict",
].map(s => `lib/${s}.c`);

/** What of the `zstd` command trains a dictionary and compresses files. */
const PROGRAM_SOURCES = ["zstdcli", "util", "timefn", "fileio", "fileio_asyncio", "dibio"].map(s => `programs/${s}.c`);

/** The `zstd` command for the machine that builds, which compresses ICU's data (deps/icu.ts): the version whose decoder bun has. */
export function hostZstdPath(cfg: Config): string {
  return join(depBuildDir(cfg, "zstd"), `zstd${cfg.host.exeSuffix}`);
}

export const zstd: Dependency = {
  name: "zstd",
  versionMacro: "ZSTD_HASH",

  source: () => ({
    kind: "github-archive",
    repo: "facebook/zstd",
    commit: ZSTD_COMMIT,
  }),

  patches: [
    // x64 targets nehalem, so zstd picks its BMI2 kernels at run time and
    // probes CPUID in every CCtx/DCtx init. CPUID is a VM exit under a
    // hypervisor (about 2 us each, two per init). Probe once instead.
    "patches/zstd/bmi2-probe-once.patch",
    // ZSTD_freeCCtx frees a context's dictionaries before joining the worker
    // threads, so a job that's still running can read freed memory.
    "patches/zstd/free-workers-before-dictionaries.patch",
  ],

  build: cfg => {
    const sources = [...SOURCES];
    const defines: Record<string, number | true> = {
      ZSTD_MULTITHREAD: true,
      ZSTD_LEGACY_SUPPORT: 0,
    };

    // Upstream's if(MSVC) block sets these for the static target.
    // ZSTD_HEAPMODE=0 makes the one-shot ZSTD_decompress() (used by
    // src/zstd/lib.rs) stack-allocate its DCtx instead of malloc/free
    // per call; the source default is 1.
    if (cfg.windows) {
      defines.ZSTD_HEAPMODE = 0;
      defines._CRT_SECURE_NO_WARNINGS = true;
    }

    // huf_decompress_amd64.S is GNU-as syntax. clang assembles it on
    // posix x64; clang-cl can't, so Windows takes the C path.
    if (cfg.x64 && !cfg.windows) {
      sources.push("lib/decompress/huf_decompress_amd64.S");
    } else {
      defines.ZSTD_DISABLE_ASM = 1;
    }

    const spec: DirectBuild = {
      kind: "direct",
      sources,
      defines,
      includes: ["lib", "lib/common"],
      pic: true,
      // XXH_NAMESPACE must be a bare token prefix (xxhash pastes it onto
      // symbol names), not a string literal — DirectBuild.defines would
      // wrap it in quotes. Avoids clashes with lshpack's copy.
      cflags: ["-DXXH_NAMESPACE=ZSTD_"],
    };
    if (cfg.icu) {
      const src = depSourceDir(cfg, "zstd");
      spec.steps = [
        {
          kind: "host-cc",
          output: hostZstdPath(cfg),
          sources: [...SOURCES, ...PROGRAM_SOURCES].map(s => join(src, s)),
          flags: [
            ...["-O2", "-w", "-pthread"],
            ...["-DZSTD_MULTITHREAD", "-DZSTD_LEGACY_SUPPORT=0", "-DZSTD_DISABLE_ASM=1", "-DXXH_NAMESPACE=ZSTD_"],
            ...["-DZSTD_NOBENCH", "-DZSTD_NOTRACE"],
            ...["lib", "lib/common", "lib/dictBuilder"].map(dir => `-I${join(src, dir)}`),
          ],
        },
      ];
    }
    return spec;
  },

  provides: () => ({
    libs: [],
    includes: ["lib"],
  }),
};
