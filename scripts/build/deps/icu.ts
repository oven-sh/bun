/**
 * ICU — the Unicode and internationalization library under JavaScriptCore (Intl, String.prototype.normalize, RegExp
 * \p{}, IDNA). For every target but macOS, which has the SDK's libicucore.
 *
 * Compiled in our graph from the release tarball that configure fetches (../icu-source.ts):
 *
 *   common/, i18n/   the files ICU's own sources.txt lists name, with the dep flags, onto bun's link line
 *   data             ../icu-data.ts drops what bun never loads and compresses the rest an item at a time, with the zstd
 *                    that deps/zstd.ts builds for this machine; the result is assembled into one object
 *
 * The settings are those of the ICU in a prebuilt WebKit (the ICU stage of oven-sh/WebKit's Dockerfiles).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { ICU_DICTIONARY_COVER, ICU_VERSION } from "../icu-source.ts";
import { type Dependency, depBuildDir, depSourceDir } from "../source.ts";
import { hostZstdPath } from "./zstd.ts";

/** A checkout of WebKit (`webkit: "local"`) takes the ICU deps/webkit.ts says, which needs no download. */
export function buildsIcu(cfg: Pick<Config, "webkit" | "darwin">): boolean {
  return cfg.webkit === "source" && !cfg.darwin;
}

/** `<unicode/*.h>` is in both. */
export function icuIncludes(cfg: Config): string[] {
  const source = join(depSourceDir(cfg, "icu"), "source");
  return [join(source, "common"), join(source, "i18n")];
}

/** All but the last are what ICU's own build passes for a static library (icudefs.mk). No charset converters: their data is left out too. */
const defines = [
  "-DU_STATIC_IMPLEMENTATION",
  "-DU_ALL_IMPLEMENTATION",
  "-DU_ATTRIBUTE_DEPRECATED=",
  "-D_REENTRANT",
  "-DUCONFIG_NO_LEGACY_CONVERSION=1",
];

export const icu: Dependency = {
  name: "icu",
  enabled: buildsIcu,
  // The zstd that compresses the data.
  fetchDeps: ["zstd"],

  // Never fetched by an edge: config.ts gives it a `localDeps` entry, like WebKit's.
  source: () => ({ kind: "github-archive", repo: "unicode-org/icu", commit: `release-${ICU_VERSION}` }),

  build: cfg => {
    const B = depBuildDir(cfg, "icu");
    const source = join(depSourceDir(cfg, "icu"), "source");
    const library = (name: string): { list: string; sources: string[] } => {
      const list = join(source, name, "sources.txt");
      const files = readFileSync(list, "utf8").split("\n").filter(Boolean);
      return { list, sources: files.map(file => join(source, name, file)) };
    };
    const common = library("common");
    const i18n = library("i18n");

    // i18n uses dynamic_cast. Optimized as the prebuilt's ICU is whatever WebKit's build type: these come after the
    // dep flags' own level. _CRT_SECURE_NO_DEPRECATE: ICU's Visual Studio projects set it.
    const flags = cfg.windows
      ? ["/std:c++20", "/GR", "/O2", "-D_CRT_SECURE_NO_DEPRECATE", ...defines]
      : ["-std=c++20", "-frtti", "-Os", ...defines];

    const major = ICU_VERSION.split(".")[0]!;
    const script = join(cfg.cwd, "scripts", "build", "icu-data.ts");
    const input = join(source, "data", "in", `icudt${major}l.dat`);
    const keepRaw = join(depSourceDir(cfg, "WebKit"), "icu", "keep-raw.txt");
    const zstd = hostZstdPath(cfg);
    const data = join(B, "data");
    const packed = [join(data, "icudata.S"), join(data, `icudt${major}l.dat`), join(data, "icudt.zstdict")];
    const object = join(data, `icudata${cfg.objSuffix}`);
    // clang-cl does not take a .S, so clang's GNU driver assembles it for every target.
    const triple = cfg.crossTarget ?? (cfg.windows ? `${cfg.x64 ? "x86_64" : "aarch64"}-pc-windows-msvc` : undefined);

    return {
      kind: "direct",
      sources: [],
      groups: [
        {
          name: "icuuc",
          sources: common.sources,
          includes: [join(source, "common")],
          cxxflags: [...flags, "-DU_COMMON_IMPLEMENTATION"],
        },
        {
          name: "icui18n",
          sources: i18n.sources,
          includes: [join(source, "i18n"), join(source, "common")],
          cxxflags: [...flags, "-DU_I18N_IMPLEMENTATION"],
        },
      ],
      steps: [
        {
          outputs: packed,
          inputs: [input, keepRaw, zstd, script],
          cwd: cfg.cwd,
          cmd: [
            ...[cfg.bun, script, "--zstd", zstd, "--in", input, "--keep-raw", keepRaw, "--out", data],
            ...["--cover", ICU_DICTIONARY_COVER, "--obj-format", cfg.windows ? "coff" : "elf"],
          ],
          desc: "ICU data",
        },
        {
          outputs: [object],
          inputs: packed,
          cwd: cfg.cwd,
          cmd: [cfg.hostCc, ...(triple !== undefined ? [`--target=${triple}`] : []), "-c", packed[0]!, "-o", object],
          desc: "ICU data object",
        },
      ],
      libs: [object],
      configureInputs: [common.list, i18n.list],
    };
  },

  provides: cfg => ({ libs: [], includes: icuIncludes(cfg), defines: ["U_STATIC_IMPLEMENTATION=1"] }),
};
