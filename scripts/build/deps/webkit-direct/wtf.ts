/**
 * WebKit DirectBuild — WTF layer.
 *
 * 173 .cpp sources, no codegen. cmake stages a `bmalloc/Headers/` forwarding
 * tree (one `cmake -E copy` per header) so includes like `<bmalloc/X.h>`
 * resolve; we skip the copy and add `Source/bmalloc` (and libpas) to -I
 * directly — same files, no staging.
 */

import type { Dependency } from "../../source.ts";
import { depBuildDir } from "../../source.ts";
import { webkitDirectSource } from "./bmalloc.ts";
import { commonDefines, layerData, webkitCFlags, webkitCxxFlags } from "./common.ts";

const layer = layerData.WTF;

// Forwarding-header dirs cmake stages → the source dirs they mirror.
// $BUILD (the cmake root) is where cmakeconfig.h lives; we put that in
// webkit-bmalloc's buildDir instead.
const SRC_INCLUDES = layer.includes.filter(i => i.startsWith("$SRC/")).map(i => i.replace("$SRC/", ""));

export const webkitWTF: Dependency = {
  name: "webkit-wtf",
  enabled: cfg => cfg.webkit === "direct",
  fetchDeps: ["webkit-bmalloc"],

  source: webkitDirectSource,

  build: cfg => ({
    kind: "direct",
    pic: true,
    sources: layer.sources.map(s => s.replace("$SRC/", "")),
    includes: SRC_INCLUDES,
    defines: {
      ...commonDefines,
      BUILDING_WTF: true,
      PAS_BMALLOC: 1,
      STATICALLY_LINKED_WITH_bmalloc: true,
      ...(cfg.linux && { _GNU_SOURCE: true, _GLIBCXX_ASSERTIONS: 1 }),
    },
    cflags: [...webkitCFlags(cfg), `-I${depBuildDir(cfg, "webkit-bmalloc")}`],
    cxxflags: webkitCxxFlags(cfg),
  }),

  provides: () => ({
    libs: [],
    includes: ["Source/WTF"],
  }),
};
