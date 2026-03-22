/**
 * Convenience wrapper to register all ninja rules in one call.
 *
 * Ninja requires all rules to be defined before any `build` statement
 * references them. Each module that emits build statements has its own
 * `registerXxxRules()` function. The order of registration doesn't matter
 * (rules are named), but every register call must happen before the first
 * emit call.
 *
 * This wrapper exists so the main configure entry point doesn't need to
 * know which rules each phase uses. Call this once, then emit everything.
 *
 * ## Why not auto-register in each emit function?
 *
 * Considered. The problem: some rules are SHARED (e.g. dep_configure is
 * used by both source.ts deps AND webkit.ts local mode). If each emit
 * function auto-registered, we'd need idempotent registration (rule
 * already exists → skip). That's not hard, but it makes the "which rule
 * lives where" question fuzzy. Explicit registration is clearer.
 */

import { registerCodegenRules } from "./codegen.ts";
import { registerCompileRules, registerDirStamps } from "./compile.ts";
import type { Config } from "./config.ts";
import type { Ninja } from "./ninja.ts";
import { registerDepRules } from "./source.ts";
import { registerZigRules } from "./zig.ts";

/**
 * Register every ninja rule. Call once at the top of configure, before
 * any `emitXxx()` or `resolveXxx()` calls.
 *
 * Safe to call even if some rules go unused for a given config — unused
 * rules in build.ninja are ignored by ninja.
 */
export function registerAllRules(n: Ninja, cfg: Config): void {
  // mkdir_stamp rule + obj/pch dir stamps. Must be first — codegen
  // registers its own dir stamp using this rule.
  registerDirStamps(n, cfg);

  // cxx, cc, pch, link, ar
  registerCompileRules(n, cfg);

  // dep_fetch, dep_fetch_prebuilt, dep_configure, dep_build, dep_cargo
  // WebKit prebuilt uses dep_fetch_prebuilt; local uses dep_configure/dep_build.
  registerDepRules(n, cfg);

  // codegen, esbuild, bun_install + codegen/stamps dir stamps
  registerCodegenRules(n, cfg);

  // zig_fetch, zig_build
  registerZigRules(n, cfg);
}
