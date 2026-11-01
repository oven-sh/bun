/**
 * ICU — the Unicode and internationalization library under JavaScriptCore (Intl, String.prototype.normalize, RegExp
 * \p{}, IDNA). Compiled with the pinned WebKit (`cfg.icu`) for every target but macOS, which has the SDK's libicucore.
 *
 * In our graph, from the release tarball that configure fetches (../icu-source.ts):
 *
 *   common/, i18n/   the files ICU's own sources.txt lists name, with the dep flags, onto bun's link line
 *   data             ../icu-repack.ts drops what bun never loads and compresses the rest an item at a time, with the zstd
 *                    that deps/zstd.ts builds for this machine; the result is assembled into one object
 *
 * The settings restate those of the ICU in a prebuilt WebKit (the ICU stage of oven-sh/WebKit's Dockerfiles). Nothing
 * checks that they still agree.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Config } from "../config.ts";
import { assert } from "../error.ts";
import { type Dependency, depBuildDir, depSourceDir } from "../source.ts";
import { hostZstdPath } from "./zstd.ts";

/** What icu/source.json of the pinned WebKit says. Written here too so that both are fetched at once; configure compares them. */
export const ICU_VERSION = "79.1";
export const ICU_SHA256 = "06fa63ecb521048f8082f12ad988f6b678d90cbd88aafce24cbc94902b191d99";
export const ICU_URL = `https://github.com/unicode-org/icu/releases/download/release-${ICU_VERSION}/icu4c-${ICU_VERSION}-sources.tgz`;

/**
 * What zstd's search for the best dictionary (`--train-cover` by itself) settles on for a version's data. Given them it
 * trains the same dictionary in 8 seconds; the search ("search") takes 5 minutes of CPU and prints them.
 */
const dictionaryCover: Record<string, string> = { "79.1": "k=290,d=6" };

/** `<unicode/*.h>` is in both. deps/webkit.ts provides them to bun, as it does those of every other ICU. */
export function icuIncludes(cfg: Config): string[] {
  const source = join(depSourceDir(cfg, "icu"), "source");
  return [join(source, "common"), join(source, "i18n")];
}

export const icu: Dependency = {
  name: "icu",
  enabled: cfg => cfg.icu,

  // Never fetched by an edge: config.ts gives it a `localDeps` entry, like WebKit's.
  source: () => ({ kind: "github-archive", repo: "unicode-org/icu", commit: `release-${ICU_VERSION}` }),

  build: cfg => {
    const source = join(depSourceDir(cfg, "icu"), "source");
    const lists = ["common", "i18n"].map(library => join(source, library, "sources.txt"));
    const sources = lists.flatMap(list =>
      readFileSync(list, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(file => join(dirname(list), file)),
    );

    const cover = dictionaryCover[ICU_VERSION];
    assert(cover !== undefined, `There are no dictionary parameters for ICU ${ICU_VERSION}'s data`, {
      file: import.meta.filename,
      hint: 'Make its entry in dictionaryCover "search" and build: the "ICU data" step prints what to put there',
    });
    const major = ICU_VERSION.split(".")[0]!;
    const script = join(cfg.cwd, "scripts", "build", "icu-repack.ts");
    const input = join(source, "data", "in", `icudt${major}l.dat`);
    const keepRaw = join(depSourceDir(cfg, "WebKit"), "icu", "keep-raw.txt");
    const zstd = hostZstdPath(cfg);
    const data = join(depBuildDir(cfg, "icu"), "data");
    const [assembly, ...blobs] = ["icudata.S", `icudt${major}l.dat`, "icudt.zstdict"].map(file => join(data, file));
    const object = join(data, `icudata${cfg.objSuffix}`);
    const triple = cfg.crossTarget ?? (cfg.windows ? `${cfg.x64 ? "x86_64" : "aarch64"}-pc-windows-msvc` : undefined);

    return {
      kind: "direct",
      sources: [],
      groups: [
        {
          name: "icu-objects",
          sources,
          includes: icuIncludes(cfg),
          cxxflags: [
            // i18n uses dynamic_cast. Optimized as the prebuilt's ICU is, whatever the build type: these come after the
            // dep flags' own level. _CRT_SECURE_NO_DEPRECATE: ICU's Visual Studio projects set it.
            ...(cfg.windows
              ? ["/std:c++20", "/GR", "/O2", "-D_CRT_SECURE_NO_DEPRECATE"]
              : ["-std=c++20", "-frtti", "-Os"]),
            // What ICU's own build passes for a static library (icudefs.mk). In one, the two that name a library only
            // say that the file is ICU's own.
            ...["-DU_STATIC_IMPLEMENTATION", "-DU_ALL_IMPLEMENTATION", "-DU_ATTRIBUTE_DEPRECATED=", "-D_REENTRANT"],
            ...["-DU_COMMON_IMPLEMENTATION", "-DU_I18N_IMPLEMENTATION"],
            // No charset converters: their data is left out too.
            "-DUCONFIG_NO_LEGACY_CONVERSION=1",
          ],
        },
      ],
      steps: [
        {
          outputs: [assembly!, ...blobs],
          inputs: [input, keepRaw, zstd, script],
          cwd: cfg.cwd,
          cmd: [
            ...[cfg.bun, script, "--zstd", zstd, "--in", input, "--keep-raw", keepRaw, "--out", data],
            ...["--cover", cover, "--obj-format", cfg.windows ? "coff" : "elf"],
          ],
          desc: "ICU data",
        },
        // For the target, but clang-cl does not take a .S: clang's GNU driver assembles it for every one.
        {
          kind: "host-cc",
          output: object,
          sources: [assembly!],
          flags: [...(triple !== undefined ? [`--target=${triple}`] : []), "-c"],
          inputs: blobs,
        },
      ],
      libs: [object],
      configureInputs: lists,
    };
  },

  provides: () => ({ libs: [], includes: [] }),
};
