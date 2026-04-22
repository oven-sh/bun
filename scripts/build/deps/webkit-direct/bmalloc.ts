/**
 * WebKit DirectBuild — bmalloc layer.
 *
 * Source: vendor/WebKit/ (auto-fetched as a github-archive at the pinned
 * WEBKIT_VERSION if missing) or $BUN_WEBKIT_PATH if set. WTF and JSC point
 * at the same tree; ordering between layers is via `fetchDeps`.
 *
 * bmalloc: 170 sources (12 .cpp from bmalloc proper, 158 .c from libpas),
 * no codegen. The hand-written feature header (which WebKit's source
 * includes as `cmakeconfig.h`) is emitted under this dep's buildDir;
 * WTF/JSC add it to their include path.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "../../config.ts";
import type { Dependency, Source } from "../../source.ts";
import { depBuildDir } from "../../source.ts";
import { commonDefines, layerData, webkitCFlags, webkitCxxFlags } from "./common.ts";
import { cmakeconfigH } from "./feature-defines.ts";

let fetched = false;

/**
 * Shared `source` for all three direct layers.
 *
 * Unlike other deps, the fetch runs SYNCHRONOUSLY at configure time (not
 * as a ninja edge). WTF/JSC need the tree on disk during configure —
 * forwardHeaders globs the source, unifiedBundles() exec's a script over
 * Sources.txt — so the source must exist before resolveDep() reaches
 * those layers. cmake's local-mode equivalent has the same constraint
 * (it execute_process's the bundle script).
 *
 * If $BUN_WEBKIT_PATH points at a real checkout, that wins (lets you
 * iterate on JSC without re-downloading). Otherwise the oven-sh/WebKit
 * archive at WEBKIT_VERSION lands in vendor/WebKit/ (~80 MB extracted).
 */
export function webkitDirectSource(cfg: Config): Source {
  const path = cfg.webkitPath;
  if (!fetched && !existsSync(join(path, "Source", "JavaScriptCore"))) {
    // Custom $BUN_WEBKIT_PATH that doesn't exist → user error, don't
    // silently download somewhere unexpected.
    if (path !== resolve(cfg.vendorDir, "WebKit")) {
      throw new Error(
        `$BUN_WEBKIT_PATH='${path}' does not contain a WebKit checkout. ` +
          `Unset it to auto-fetch into vendor/WebKit/, or clone oven-sh/WebKit there.`,
      );
    }
    // GitHub's /archive/ endpoint 422s on repos this size, so shallow-clone
    // instead. ~500 MB on disk, fetch-by-commit needs the longer dance
    // (init → remote add → fetch <sha> → checkout).
    const sha = cfg.webkitVersion;
    process.stderr.write(`[webkit-direct] shallow-cloning oven-sh/WebKit@${sha.slice(0, 12)} → ${path}\n`);
    process.stderr.write(`[webkit-direct] (~500 MB; set $BUN_WEBKIT_PATH to reuse an existing clone)\n`);
    const git = (args: string[]) => execFileSync("git", args, { stdio: "inherit" });
    git(["init", "--quiet", path]);
    git(["-C", path, "remote", "add", "origin", "https://github.com/oven-sh/WebKit.git"]);
    git(["-C", path, "fetch", "--depth=1", "--quiet", "origin", sha]);
    git(["-C", path, "checkout", "--quiet", "FETCH_HEAD"]);
  }
  fetched = true;
  // Warn if the existing clone is on a different commit. data.json's source
  // lists were extracted at WEBKIT_VERSION; a mismatched checkout will fail
  // with "missing and no known rule" for any file that moved.
  try {
    const head = execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (head !== cfg.webkitVersion) {
      process.stderr.write(
        `[webkit-direct] WARNING: ${path} is at ${head.slice(0, 12)}, ` +
          `expected ${cfg.webkitVersion.slice(0, 12)}.\n` +
          `  Source lists in webkit-direct/data.json were extracted at the expected commit;\n` +
          `  a mismatch will fail with "missing and no known rule to make it".\n` +
          `  Fix: git -C ${path} fetch origin && git -C ${path} checkout ${cfg.webkitVersion}\n`,
      );
    }
  } catch {
    // Not a git repo (e.g. extracted tarball) — skip the check.
  }
  return { kind: "local", path };
}

const layer = layerData.bmalloc;

export const webkitBmalloc: Dependency = {
  name: "bmalloc",
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
    includes: ["Source/bmalloc", depBuildDir(cfg, "bmalloc")],
  }),
};
