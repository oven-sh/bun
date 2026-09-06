/**
 * ICU — Unicode/i18n library under JavaScriptCore (Intl.*, String.normalize,
 * RegExp \\p{}, IDNA, ...). Every target but macOS, which uses the SDK's
 * libicucore instead.
 *
 * Built directly in our graph from the ICU release tarball (which, unlike the
 * git repo, ships the prebuilt data package):
 *
 *   common/, i18n/          icu-sources.ts (ICU's sources.txt lists, kept by
 *                           generate-dep-sources.ts), compiled with dep flags
 *                           straight onto bun's link line
 *   icupkg (host)           common + i18n + toolutil + stubdata for the BUILD
 *                           machine — reads/filters the data package
 *   data                    icu-data.ts: filter items bun never loads, guard
 *                           the rbnf keep-list, zstd-repack per item with a
 *                           trained dictionary, emit icudata.S; assembled here
 *
 * The per-item decompression hook (patches/icu/udata-decompress-hook.patch)
 * is a weak symbol bun defines in src/jsc/bindings/bun_icu_decompress.cpp.
 */

import { join } from "node:path";
import type { Config } from "../config.ts";
import { type Dependency, type DirectSource, depBuildDir, depSourceDir } from "../source.ts";
import {
  icuCommonSources,
  icuI18nSources,
  icuIcupkgSources,
  icuStubdataSources,
  icuToolutilSources,
} from "./icu-sources.ts";

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

  source: () => ({ kind: "tarball", url: ICU_URL, sha256: ICU_SHA256, version: ICU_VERSION }),
  patches: ["patches/icu/udata-decompress-hook.patch"],

  build: cfg => {
    const B = depBuildDir(cfg, "icu");
    const S = join(depSourceDir(cfg, "icu"), "source");
    const common = join(S, "common");
    const i18n = join(S, "i18n");
    const inS = (list: readonly string[]) => list.map(f => join(S, f));

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
      ...inS(icuCommonSources).map(path => ({ path, cflags: ["-DU_COMMON_IMPLEMENTATION"] })),
      ...inS(icuI18nSources).map(path => ({ path, cflags: ["-DU_I18N_IMPLEMENTATION"] })),
      ...inS(icuStubdataSources).map(path => ({ path })),
      ...inS(icuToolutilSources).map(path => ({ path })),
      ...inS(icuIcupkgSources).map(path => ({ path })),
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
          sources: inS(icuCommonSources),
          includes: [common],
          cxxflags: [...libFlags, "-DU_COMMON_IMPLEMENTATION"],
        },
        {
          name: "icui18n",
          sources: inS(icuI18nSources),
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
          // wintz.cpp reads the registry (advapi32) on a Windows host.
          ldflags: cfg.host.os === "linux" ? ["-ldl", "-lpthread"] : cfg.host.os === "windows" ? ["-ladvapi32"] : [],
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
    };
  },

  // U_STATIC_IMPLEMENTATION reaches bun's own TUs through `defines`.
  provides: cfg => ({ libs: [], includes: icuIncludes(cfg), defines: ["U_STATIC_IMPLEMENTATION=1"] }),
};
