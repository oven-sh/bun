/**
 * Platform shims — small dylibs/objects linked into the bun executable to
 * work around toolchain or OS bugs.
 *
 * Each shim is a ninja build edge (source → output), so ninja handles
 * rebuild-on-change. `emitShims()` registers the edges and returns the
 * linker flags + implicit inputs to spread into the final link() call.
 *
 * Every shim MUST have an entry in workarounds.ts that fails configure
 * once the upstream fix ships — see that file for the pattern.
 */

import { resolve } from "node:path";
import type { Config } from "./config.ts";
import type { Ninja } from "./ninja.ts";
import { quote } from "./shell.ts";

export interface ShimLinkOpts {
  /** Extra ldflags to append to the link() call. */
  ldflags: string[];
  /** Implicit inputs — ninja relinks if these change. */
  implicitInputs: string[];
}

const ASAN_DYLD_SHIM = "asan-dyld-shim.dylib";

/**
 * Register shim compile rules. Call once from rules.ts alongside the
 * other registerXxxRules() calls.
 */
export function registerShimRules(n: Ninja, cfg: Config): void {
  if (!(cfg.darwin && cfg.asan)) return;

  const q = (p: string) => quote(p, false);
  // -install_name @rpath/<name> so dyld resolves it next to the
  // executable via the -rpath @executable_path we add at link time.
  // __DATA,__interpose only works from dylibs (not object files linked
  // into the main binary), hence -dynamiclib.
  n.rule("shim_dylib", {
    command: `${q(cfg.cc)} -dynamiclib -O2 -install_name @rpath/$name -o $out $in`,
    description: "shim $name",
  });
}

/**
 * Emit shim build edges and return link flags. Call once per link site
 * (emitBun, emitLinkOnly) before the link() call.
 *
 * Currently just the macOS 26.4 ASAN dyld deadlock shim. See
 * scripts/build/shims/asan-dyld-shim.c for the mechanism and
 * scripts/build/workarounds.ts for the self-obsoleting check.
 */
export function emitShims(n: Ninja, cfg: Config): ShimLinkOpts {
  if (!(cfg.darwin && cfg.asan)) return { ldflags: [], implicitInputs: [] };

  const src = resolve(cfg.cwd, "scripts", "build", "shims", "asan-dyld-shim.c");
  const out = resolve(cfg.buildDir, ASAN_DYLD_SHIM);

  n.build({
    outputs: [out],
    rule: "shim_dylib",
    inputs: [src],
    vars: { name: ASAN_DYLD_SHIM },
  });

  return {
    ldflags: [out, "-Wl,-rpath,@executable_path"],
    implicitInputs: [out],
  };
}
