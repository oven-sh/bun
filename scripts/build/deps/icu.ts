/**
 * ICU — Unicode/i18n library under JavaScriptCore (Intl.*, String.normalize,
 * RegExp \\p{}, IDNA, ...). Every target but macOS, which uses the SDK's
 * libicucore instead.
 *
 * Built directly in our graph from the ICU release tarball (which, unlike the
 * git repo, ships the prebuilt data package):
 *
 *   common/, i18n/          file lists from ICU's own sources.txt, compiled
 *                           with dep flags straight onto bun's link line
 *   icupkg (host)           common + i18n + toolutil + stubdata for the BUILD
 *                           machine — reads/filters the data package
 *   data                    icu-data.ts: filter items bun never loads, guard
 *                           the rbnf keep-list, zstd-repack per item with a
 *                           trained dictionary, emit icudata.S; assembled here
 *
 * The per-item decompression hook (patches/icu/udata-decompress-hook.patch)
 * is a weak symbol bun defines in src/jsc/bindings/bun_icu_decompress.cpp.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { BuildError } from "../error.ts";
import { type Dependency, type DirectSource, depBuildDir, depSourceDir } from "../source.ts";

const ICU_VERSION = "78.3";
const ICU_MAJOR = ICU_VERSION.split(".")[0]!;
const ICU_URL = `https://github.com/unicode-org/icu/releases/download/release-${ICU_VERSION}/icu4c-${ICU_VERSION}-sources.tgz`;
const ICU_SHA256 = "3a2e7a47604ba702f345878308e6fefeca612ee895cf4a5f222e7955fabfe0c0";

/** Whether this config builds ICU itself (vs. the macOS SDK's libicucore). */
export function buildsIcu(cfg: Config): boolean {
  return cfg.webkit === "source" && !cfg.darwin;
}

/** Include dirs consumers need: `<unicode/*.h>` live under both. */
export function icuIncludes(cfg: Config): string[] {
  const S = join(depSourceDir(cfg, "icu"), "source");
  return [join(S, "common"), join(S, "i18n")];
}

/** ICU's per-directory `sources.txt`: one file name per line. */
function sourcesTxt(dir: string): string[] {
  return readFileSync(join(dir, "sources.txt"), "utf8")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => join(dir, s));
}

/**
 * Preprocessor settings shared by the target libs and the host tool — what
 * ICU's configure passes (icudefs.mk) plus bun's choices: static, no legacy
 * charset converters (UCONFIG_NO_LEGACY_CONVERSION; their data is filtered
 * out of the package too).
 */
const icuDefines = [
  "-DU_STATIC_IMPLEMENTATION",
  "-DU_ALL_IMPLEMENTATION",
  "-DU_ATTRIBUTE_DEPRECATED=",
  "-DUCONFIG_NO_LEGACY_CONVERSION=1",
  "-D_REENTRANT",
];

export const icu: Dependency = {
  name: "icu",
  versionMacro: "ICU",
  enabled: buildsIcu,
  configureReadsSource: true,

  source: () => ({ kind: "tarball", url: ICU_URL, sha256: ICU_SHA256, version: ICU_VERSION }),
  patches: ["patches/icu/udata-decompress-hook.patch"],

  build: cfg => {
    const B = depBuildDir(cfg, "icu");
    const S = join(depSourceDir(cfg, "icu"), "source");
    const common = join(S, "common");
    const i18n = join(S, "i18n");
    // The data below is zstd-repacked per item; loading it needs the
    // decompress hook that patches/icu adds to udata.cpp. A --local-deps tree
    // is used as-is (no patches applied), so it must already carry it.
    if (!readFileSync(join(common, "udata.cpp"), "utf8").includes("bun_icu_maybe_decompress")) {
      throw new BuildError(`ICU source at ${S} lacks the udata decompress hook`, {
        hint: "apply patches/icu/*.patch to that tree (git apply), or drop icu from --local-deps",
      });
    }

    // ICU needs RTTI (dynamic_cast in i18n). Optimization level is the one
    // the fork's ICU stage used regardless of WebKit build type — -Os on
    // unix, /O2 on Windows — placed after the dep-global -O<n> so it wins.
    // clang-cl spellings on Windows; /GR after the dep-global /GR-;
    // _CRT_SECURE_NO_DEPRECATE as ICU's own MSVC project files set.
    const libFlags = cfg.windows
      ? ["/std:c++20", "/GR", "/O2", "-D_CRT_SECURE_NO_DEPRECATE", ...icuDefines]
      : ["-std=c++20", "-frtti", "-Os", ...icuDefines];

    // ─── Host icupkg ───
    // Reads, filters and extracts the data package at build time, so it runs
    // on the build machine. stubdata supplies an empty icudt<NN>_dat so
    // common links without real data. ICU's sources insist on their own
    // library's *_IMPLEMENTATION define.
    const hostSources: DirectSource[] = [
      ...sourcesTxt(common).map(path => ({ path, cflags: ["-DU_COMMON_IMPLEMENTATION"] })),
      ...sourcesTxt(i18n).map(path => ({ path, cflags: ["-DU_I18N_IMPLEMENTATION"] })),
      ...sourcesTxt(join(S, "stubdata")).map(path => ({ path })),
      ...sourcesTxt(join(S, "tools", "toolutil")).map(path => ({ path })),
      ...sourcesTxt(join(S, "tools", "icupkg")).map(path => ({ path })),
    ];
    const icupkg = join(B, `icupkg${cfg.host.exeSuffix}`);

    // ─── Data ───
    const dataDir = join(B, "data");
    const inDat = join(S, "data", "in", `icudt${ICU_MAJOR}l.dat`);
    const keepRaw = join(cfg.cwd, "scripts", "build", "icu-keep-raw.txt");
    const dataScript = join(cfg.cwd, "scripts", "build", "icu-data.ts");
    const outDat = join(dataDir, `icudt${ICU_MAJOR}l.dat`);
    const dict = join(dataDir, "icudt.zstdict");
    const asm = join(dataDir, "icudata.S");
    // The .S only names the two blobs (.incbin). clang-cl does not take .S,
    // so it is assembled by the GNU-driver clang for the target on every
    // platform (host clang; the triple decides the object format).
    const dataObj = join(dataDir, `icudata${cfg.objSuffix}`);
    const triple =
      cfg.crossTarget ?? (cfg.windows ? (cfg.x64 ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc") : undefined);

    return {
      kind: "direct",
      sources: [],
      groups: [
        {
          name: "icuuc",
          sources: sourcesTxt(common),
          includes: [common],
          cxxflags: [...libFlags, "-DU_COMMON_IMPLEMENTATION"],
        },
        {
          name: "icui18n",
          sources: sourcesTxt(i18n),
          includes: [i18n, common],
          cxxflags: [...libFlags, "-DU_I18N_IMPLEMENTATION"],
        },
      ],
      steps: [
        {
          kind: "host-exe",
          output: "icupkg",
          sources: hostSources,
          flags: [
            "-O1",
            "-std=c++20",
            "-fno-exceptions",
            "-w",
            ...icuDefines,
            "-DU_TOOLUTIL_IMPLEMENTATION",
            `-I${common}`,
            `-I${i18n}`,
            `-I${join(S, "tools", "toolutil")}`,
          ],
          ldflags: cfg.host.os === "linux" ? ["-ldl", "-lpthread"] : [],
        },
        {
          outputs: [asm, outDat, dict],
          inputs: [inDat, icupkg, keepRaw, dataScript],
          cmd: [
            ...cfg.jsRuntimeArgv,
            dataScript,
            "--icupkg",
            icupkg,
            "--in",
            inDat,
            "--out",
            dataDir,
            "--keep-raw",
            keepRaw,
            "--obj-format",
            cfg.windows ? "coff" : "elf",
          ],
          desc: "icu data (filter + zstd repack)",
        },
        {
          outputs: [dataObj],
          inputs: [asm, outDat, dict],
          cmd: [cfg.hostCc, ...(triple !== undefined ? [`--target=${triple}`] : []), "-c", asm, "-o", dataObj],
          desc: "icu data object",
        },
      ],
      linkObjects: [dataObj],
      configureInputs: [join(common, "sources.txt"), join(i18n, "sources.txt")],
    };
  },

  // U_STATIC_IMPLEMENTATION reaches bun's own TUs through `defines`.
  provides: cfg => ({ libs: [], includes: icuIncludes(cfg), defines: ["U_STATIC_IMPLEMENTATION=1"] }),
};
