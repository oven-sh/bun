/**
 * ICU — Unicode/i18n library under JavaScriptCore (Intl.*, String.normalize,
 * RegExp \p{}, IDNA, ...). Used with `--webkit=source`; the prebuilt WebKit
 * tarball carries its own copy built the same way, and macOS uses the SDK's
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
import { cc, cxx } from "../compile.ts";
import type { Config } from "../config.ts";
import { BuildError } from "../error.ts";
import { computeDepFlags } from "../flags.ts";
import type { Ninja } from "../ninja.ts";
import { quote, quoteArgs } from "../shell.ts";
import { type CustomBuildContext, type CustomBuildResult, type Dependency, depBuildDir } from "../source.ts";

const ICU_VERSION = "78.3";
const ICU_MAJOR = ICU_VERSION.split(".")[0]!;
const ICU_URL = `https://github.com/unicode-org/icu/releases/download/release-${ICU_VERSION}/icu4c-${ICU_VERSION}-sources.tgz`;
const ICU_SHA256 = "3a2e7a47604ba702f345878308e6fefeca612ee895cf4a5f222e7955fabfe0c0";

/** Whether this config builds ICU itself (vs. prebuilt WebKit's copy / the macOS SDK's). */
export function buildsIcu(cfg: Config): boolean {
  return cfg.webkit === "source" && !cfg.darwin;
}

/** Include dirs consumers need: `<unicode/*.h>` live under both. */
export function icuIncludes(cfg: Config, srcDir: string): string[] {
  void cfg;
  return [join(srcDir, "source", "common"), join(srcDir, "source", "i18n")];
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

  source: () => ({ kind: "tarball", url: ICU_URL, sha256: ICU_SHA256, version: ICU_VERSION }),
  patches: ["patches/icu/udata-decompress-hook.patch"],

  build: () => ({ kind: "custom", emit: emitIcu }),

  // emitIcu reports these (CustomBuild); U_STATIC_IMPLEMENTATION reaches bun's
  // own TUs through `defines`.
  provides: () => ({ libs: [], includes: [], defines: ["U_STATIC_IMPLEMENTATION=1"] }),
};

function emitIcu(n: Ninja, cfg: Config, { srcDir, ready }: CustomBuildContext): CustomBuildResult {
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  const B = depBuildDir(cfg, "icu");
  const S = join(srcDir, "source");
  const common = join(S, "common");
  const i18n = join(S, "i18n");
  // The data below is zstd-repacked per item; loading it needs the
  // decompress hook that patches/icu adds to udata.cpp. A --local-deps tree
  // is used as-is (no patches applied), so it must already carry it.
  if (!readFileSync(join(common, "udata.cpp"), "utf8").includes("bun_icu_maybe_decompress")) {
    throw new BuildError(`ICU source at ${srcDir} lacks the udata decompress hook`, {
      hint: "apply patches/icu/*.patch to that tree (git apply), or drop icu from --local-deps",
    });
  }

  n.comment("─── icu (common + i18n + data) ───");

  // ─── Target libraries ───
  const dep = computeDepFlags(cfg);
  // ICU needs RTTI (dynamic_cast in i18n). Optimization level is the one the
  // fork's ICU stage used regardless of WebKit build type — -Os on unix, -O2
  // (/O2) on Windows — placed after the dep-global -O<n> so it wins. PIC
  // policy as for bun's own objects (non-PIE executable except on Android).
  const pic = cfg.abi === "android" ? ["-fPIC"] : cfg.unix ? ["-fno-pic", "-fno-pie"] : [];
  const cxxflags = cfg.windows
    ? // clang-cl spellings; /GR after the dep-global /GR-. _CRT_SECURE_NO_DEPRECATE
      // as ICU's own MSVC project files set.
      [...dep.cxxflags, "/std:c++20", "/GR", "/O2", "-D_CRT_SECURE_NO_DEPRECATE", ...icuDefines]
    : [...dep.cxxflags, ...pic, "-std=c++20", "-frtti", "-Os", "-fno-exceptions", ...icuDefines];
  const ucObjects = sourcesTxt(common).map(src =>
    cxx(n, cfg, src, { flags: [...cxxflags, "-DU_COMMON_IMPLEMENTATION", `-I${q(common)}`], orderOnlyInputs: ready }),
  );
  const i18nObjects = sourcesTxt(i18n).map(src =>
    cxx(n, cfg, src, {
      flags: [...cxxflags, "-DU_I18N_IMPLEMENTATION", `-I${q(i18n)}`, `-I${q(common)}`],
      orderOnlyInputs: ready,
    }),
  );

  // ─── Host icupkg ───
  // Reads, filters and extracts the data package at build time, so it runs on
  // the build machine: host compiler, no target flags. stubdata supplies an
  // empty icudt<NN>_dat so common links without real data.
  const hostObjDir = join(B, "host-obj");
  const hostFlags = [
    "-O1",
    "-std=c++20",
    "-fno-exceptions",
    "-w",
    ...icuDefines,
    "-DU_TOOLUTIL_IMPLEMENTATION",
    `-I${q(common)}`,
    `-I${q(i18n)}`,
    `-I${q(join(S, "tools", "toolutil"))}`,
  ];
  const hostSources = [
    ...sourcesTxt(common),
    ...sourcesTxt(i18n),
    ...sourcesTxt(join(S, "stubdata")),
    ...sourcesTxt(join(S, "tools", "toolutil")),
    ...sourcesTxt(join(S, "tools", "icupkg")),
  ];
  const hostObjects = hostSources.map(src => {
    const rel = src.slice(S.length + 1).replaceAll("\\", "/");
    const obj = join(hostObjDir, `${rel}.o`);
    // ICU's sources insist on their own library's *_IMPLEMENTATION define.
    const impl = rel.startsWith("common/")
      ? ["-DU_COMMON_IMPLEMENTATION"]
      : rel.startsWith("i18n/")
        ? ["-DU_I18N_IMPLEMENTATION"]
        : [];
    n.build({
      outputs: [obj],
      rule: "host_cxx",
      inputs: [src],
      orderOnlyInputs: ready,
      vars: { flags: [...hostFlags, ...impl].join(" ") },
    });
    return obj;
  });
  const icupkg = join(B, `icupkg${cfg.host.exeSuffix}`);
  n.build({
    outputs: [icupkg],
    rule: "host_link",
    inputs: hostObjects,
    vars: { flags: cfg.host.os === "linux" ? "-ldl -lpthread" : "" },
  });
  n.phony("icupkg", [icupkg]);

  // ─── Data ───
  const dataDir = join(B, "data");
  const inDat = join(S, "data", "in", `icudt${ICU_MAJOR}l.dat`);
  const keepRaw = join(cfg.cwd, "scripts", "build", "icu-keep-raw.txt");
  const dataScript = join(cfg.cwd, "scripts", "build", "icu-data.ts");
  const outDat = join(dataDir, `icudt${ICU_MAJOR}l.dat`);
  const dict = join(dataDir, "icudt.zstdict");
  const asm = join(dataDir, "icudata.S");
  n.build({
    outputs: [asm, outDat, dict],
    rule: "dep_codegen",
    inputs: [inDat],
    implicitInputs: [icupkg, keepRaw, dataScript],
    vars: {
      name: "icu",
      desc: "icu data (filter + zstd repack)",
      cmd: `${cfg.jsRuntime} ${quoteArgs(
        [
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
        hostWin,
      )}`,
    },
  });
  // The .S only names the two blobs (.incbin); when they change it must
  // reassemble. clang-cl does not take .S, so a Windows target assembles it
  // with the GNU-driver clang for the same triple (COFF directives inside).
  let dataObj: string;
  if (cfg.windows) {
    dataObj = join(B, `icudata${cfg.objSuffix}`);
    n.build({
      outputs: [dataObj],
      rule: "icu_asm",
      inputs: [asm],
      implicitInputs: [outDat, dict],
      vars: { target: cfg.crossTarget ?? (cfg.x64 ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc") },
    });
  } else {
    dataObj = cc(n, cfg, asm, { flags: dep.cflags.filter(f => !f.startsWith("-g")), implicitInputs: [outDat, dict] });
  }

  const objects = [...i18nObjects, ...ucObjects, dataObj];
  n.phony("icu", objects);
  return {
    objects,
    includes: icuIncludes(cfg, srcDir),
    outputs: [...ready],
    configureInputs: [join(common, "sources.txt"), join(i18n, "sources.txt")],
  };
}

/** Rules for the edges above (host tool compile/link, data pipeline). */
export function registerIcuRules(n: Ninja, cfg: Config): void {
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  n.rule("host_cxx", {
    command: `${q(cfg.hostCxx)} $flags -MMD -MT $out -MF $out.d -c $in -o $out`,
    description: "host-cxx $out",
    depfile: "$out.d",
    deps: "gcc",
  });
  n.rule("host_link", {
    command: `${q(cfg.hostCxx)} -o $out @$out.rsp $flags`,
    description: "host-link $out",
    rspfile: "$out.rsp",
    rspfile_content: "$in_newline",
  });
  // Windows target: the data .S goes through the GNU-driver clang (hostCc;
  // clang-cl does not take .S) for the target triple.
  n.rule("icu_asm", {
    command: `${q(cfg.hostCc)} --target=$target -c $in -o $out`,
    description: "asm $out",
  });
}
