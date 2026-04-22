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
 * ICU install prefix. Linux uses the distro package (default search paths
 * suffice). Darwin needs brew's icu4c — Apple ships libicucore.dylib but
 * not the headers, and the version skew between Apple's lib and brew's
 * headers makes mixing them unsafe, so use brew for both -I and -L.
 * Windows builds ICU from source via build-icu.ps1 (TODO: hook up).
 */
export function icuPrefix(cfg: Config): string | undefined {
  if (!cfg.darwin) return undefined;
  return cfg.arm64 ? "/opt/homebrew/opt/icu4c" : "/usr/local/opt/icu4c";
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
  const icu = icuPrefix(cfg);
  if (icu !== undefined) flags.push(`-I${icu}/include`);
  return flags;
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
