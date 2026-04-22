/**
 * WebKit DirectBuild — bmalloc layer.
 *
 * Source comes from the same user-managed clone as `--webkit=local`
 * (vendor/WebKit/ or $BUN_WEBKIT_PATH). No auto-fetch — the clone is too
 * large for the build system to manage. WTF and JSC point at the same
 * path; ordering between layers is via `fetchDeps`.
 *
 * bmalloc: 170 sources (12 .cpp from bmalloc proper, 158 .c from libpas),
 * no codegen. The hand-written feature header (which WebKit's source
 * includes as `cmakeconfig.h`) is emitted under this dep's buildDir;
 * WTF/JSC add it to their include path.
 */

import type { Dependency, Source } from "../../source.ts";
import { depBuildDir } from "../../source.ts";
import { webkitSrcDir } from "../webkit.ts";
import { cmakeconfigH } from "./feature-defines.ts";
import { commonDefines, layerData, webkitCFlags, webkitCxxFlags } from "./common.ts";
import type { Config } from "../../config.ts";

/**
 * Shared `source` for all three direct layers. Mirrors local mode (user
 * clones; we don't fetch). The hint nudges toward $BUN_WEBKIT_PATH so
 * worktrees share one clone.
 */
export function webkitDirectSource(cfg: Config): Source {
  return {
    kind: "local",
    path: webkitSrcDir(cfg),
    hint: process.env.BUN_WEBKIT_PATH
      ? `$BUN_WEBKIT_PATH='${process.env.BUN_WEBKIT_PATH}' does not contain a WebKit checkout`
      : "Clone oven-sh/WebKit and set $BUN_WEBKIT_PATH (or place at vendor/WebKit/)",
  };
}

const layer = layerData.bmalloc;

export const webkitBmalloc: Dependency = {
  name: "webkit-bmalloc",
  enabled: cfg => cfg.webkit === "direct",

  source: webkitDirectSource,

  build: cfg => ({
    kind: "direct",
    pic: true,
    sources: layer.sources.map(s => s.replace("$SRC/", "")),
    includes: layer.includes.map(i => i.replace("$SRC/", "")),
    defines: {
      ...commonDefines,
      BUILDING_bmalloc: true,
      PAS_BMALLOC: 1,
      ...(cfg.linux && { _GNU_SOURCE: true, _GLIBCXX_ASSERTIONS: 1 }),
    },
    cflags: webkitCFlags(cfg),
    cxxflags: webkitCxxFlags(cfg),
    headers: { "cmakeconfig.h": cmakeconfigH(cfg) },
    // Stage the merged `<bmalloc/X.h>` tree WTF/JSC include from. cmake
    // copies bmalloc/bmalloc/*.h AND libpas/src/libpas/*.h into one flat
    // `bmalloc/` dir; the source tree alone can't satisfy both because
    // they live in different subdirs.
    forwardHeaders: [
      { glob: "Source/bmalloc/bmalloc/*.h", dest: "bmalloc" },
      { glob: "Source/bmalloc/libpas/src/libpas/*.h", dest: "bmalloc" },
      { glob: "Source/bmalloc/libpas/src/libpas/*.def", dest: "bmalloc" },
    ],
  }),

  // WTF/JSC need the feature header from this layer's buildDir.
  provides: cfg => ({
    libs: [],
    includes: ["Source/bmalloc", depBuildDir(cfg, "webkit-bmalloc")],
  }),
};
