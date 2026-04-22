/**
 * Shared bits for the three WebKit DirectBuild layers.
 *
 * All three deps share one source tree (vendor/WebKit/) and one extracted
 * data table (data.json, regenerated via scripts/build/extract-webkit.ts on
 * WEBKIT_VERSION bumps). The bmalloc dep owns the github-archive fetch; WTF
 * and JSC point at the same path via `kind: "local"` and order after it via
 * fetchDeps.
 */

import type { Config } from "../../config.ts";
import { webkitSrcDir } from "../webkit.ts";
import data from "./data.json" with { type: "json" };

export interface LayerData {
  sources: string[];
  includes: string[];
  defines: string[];
}

export const layerData: Record<"bmalloc" | "WTF" | "JavaScriptCore", LayerData> = data.layers;
export const lutTables: Array<{ out: string; in: string }> = data.lutTables;
export const codegenSteps: Array<{
  outputs: string[];
  inputs: string[];
  argv: string[];
  cwd: string;
}> = data.codegen;

/** Replace $SRC/$BUILD tokens from the extracted data with absolute paths. */
export function expand(p: string, cfg: Config, buildDir: string): string {
  if (p.startsWith("$SRC/")) return `${webkitSrcDir(cfg)}/${p.slice(5)}`;
  if (p.startsWith("$BUILD/")) return `${buildDir}/${p.slice(7)}`;
  return p;
}

/**
 * ICU install prefix on darwin (brew's icu4c). Apple ships
 * libicucore.dylib but no headers; the only way to get a matching
 * header+lib pair is brew. JSCOnly suppresses PLATFORM(COCOA) so
 * Platform.h's U_DISABLE_RENAMING never fires — symbols stay versioned
 * (_77), which is what brew's lib exports. bun's own bindings must also
 * compile WITHOUT U_DISABLE_RENAMING (gated to webkit==prebuilt in
 * flags.ts) so they reference the same versioned names.
 *
 * Linux: distro ICU; default search paths, link -licu{uc,i18n,data}.
 * Windows: built from source via build-icu.ps1 (TODO: hook up).
 */
export function icuPrefix(cfg: Config): string | undefined {
  if (!cfg.darwin) return undefined;
  return cfg.arm64 ? "/opt/homebrew/opt/icu4c" : "/usr/local/opt/icu4c";
}

function icuInclude(cfg: Config): string[] {
  const p = icuPrefix(cfg);
  return p !== undefined ? [`-I${p}/include`] : [];
}

/**
 * ICU link flags for bun's final link line. Returned via Provides.linkFlags
 * so bun.ts doesn't branch on cfg.webkit. The local-cmake dep (webkit.ts)
 * has its own equivalent.
 */
export function icuLinkFlags(cfg: Config): string[] {
  if (cfg.windows) return []; // built from source via build-icu.ps1, libs come from there
  const p = icuPrefix(cfg);
  return [
    ...(p !== undefined ? [`-L${p}/lib`] : []),
    "-licuuc", "-licui18n", "-licudata",
  ];
}

/**
 * Language-agnostic flags WebKit applies to every TU (cmake's
 * WebKitCompilerFlags.cmake). Goes to both .c and .cpp.
 */
export function webkitCFlags(cfg: Config): string[] {
  const flags = [
    "-fno-strict-aliasing",
    "-fvisibility=hidden",
    "-Wno-psabi",
    "-Wno-nullability-completeness",
    "-Wno-tautological-compare",
  ];
  if (!cfg.windows) flags.push("-DU_STATIC_IMPLEMENTATION=1");
  return [...flags, ...icuInclude(cfg)];
}

/** C++-only flags. Applied via DirectBuild.cxxflags so libpas .c stays C. */
export function webkitCxxFlags(_cfg: Config): string[] {
  return [
    "-std=c++23",
    "-fno-exceptions",
    "-fno-rtti",
    "-fno-c++-static-destructors",
    "-fvisibility-inlines-hidden",
    "-Wno-noexcept-type",
  ];
}

/**
 * Defines common to every WebKit TU. Layer-specific defines (BUILDING_bmalloc
 * etc.) are appended in each layer's dep file.
 */
export const commonDefines: Record<string, true | number> = {
  BUILDING_JSCONLY__: true,
  BUILDING_WEBKIT: 1,
  BUILDING_WITH_CMAKE: 1,
  HAVE_CONFIG_H: 1,
};
