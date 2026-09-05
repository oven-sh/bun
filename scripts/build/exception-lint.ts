/**
 * jsc-exception-lint as a compiler plugin.
 *
 * scripts/jsc-exception-lint/jsc-exception-lint.cpp checks that native code
 * tests for a pending JavaScriptCore exception before it calls into JSC
 * again or returns from a ThrowScope (what BUN_JSC_validateExceptionChecks=1
 * asserts at run time, but for every path, at compile time). Built with
 * -DJSC_EXCEPTION_LINT_PLUGIN it is a clang plugin: every cxx edge for bun's
 * own sources loads it with -fplugin, it runs on the AST the compile already
 * has, and a finding is a compile error. The analysis is a few tens of
 * milliseconds per translation unit. See scripts/jsc-exception-lint/README.md.
 *
 * Inputs the plugin reads at run time (all under scripts/jsc-exception-lint):
 *   nothrow.txt             hand-written classifications
 *   summaries/webkit.tsv    how each JavaScriptCore function treats the
 *   summaries/bun.tsv       exception state, computed by run.ts
 *   baseline.tsv            findings tolerated while they are being fixed
 *
 * They are implicit inputs of every cxx edge, and a digest of them is passed
 * as a plugin argument so ccache (which hashes the command line and the
 * plugin binary, not what the plugin opens) misses when they change.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Config } from "./config.ts";
import { assert } from "./error.ts";
import type { Ninja } from "./ninja.ts";
import { quote } from "./shell.ts";

const LINT_DIR = "scripts/jsc-exception-lint";
const PLUGIN_NAME = "jsc-exception-lint";

export interface ExceptionLintOpts {
  /** For every cxx edge of bun's own sources. Ninja only, not compile_commands.json. */
  flags: string[];
  /** The plugin and its data files: a compile reruns when they change. */
  implicitInputs: string[];
}

function lintSource(cwd: string): string {
  return resolve(cwd, LINT_DIR, "jsc-exception-lint.cpp");
}

function lintDataFiles(cwd: string): { nothrow: string; summaries: string[]; baseline: string } {
  return {
    nothrow: resolve(cwd, LINT_DIR, "nothrow.txt"),
    summaries: [resolve(cwd, LINT_DIR, "summaries/webkit.tsv"), resolve(cwd, LINT_DIR, "summaries/bun.tsv")],
    baseline: resolve(cwd, LINT_DIR, "baseline.tsv"),
  };
}

/**
 * Everything `data-hash=` is computed from. These are also inputs of the
 * regen rule (configure.ts): the hash is baked into build.ninja at configure
 * time, so a direct `ninja` run after an edit to one of them has to
 * reconfigure first, or ccache would answer the recompile from its cache
 * with the old hash and the edit would never reach the plugin.
 */
export function exceptionLintConfigureInputs(cwd: string): string[] {
  const data = lintDataFiles(cwd);
  return [lintSource(cwd), data.nothrow, ...data.summaries, data.baseline];
}

/**
 * The built plugin. The clang version is in the name: a plugin is bound to
 * the exact LLVM it was built against, and an upgraded clang at the same
 * path would otherwise pick up a stale one.
 */
export function exceptionLintPluginPath(cfg: Config): string {
  const ext = cfg.host.os === "darwin" ? ".dylib" : ".so";
  return resolve(cfg.buildDir, PLUGIN_NAME, `lib${PLUGIN_NAME}-${cfg.clangVersion ?? "unknown"}${ext}`);
}

/**
 * Register the plugin build rule. Call once from rules.ts.
 */
export function registerExceptionLintRules(n: Ninja, cfg: Config): void {
  if (!cfg.exceptionLint) return;
  const q = (p: string) => quote(p, false);
  // Compiled for the BUILD HOST (no --target/-isysroot) by the host clang++
  // and loaded into the clang that compiles bun. The symbols it needs come
  // from the compiler process at load time, so nothing is linked here;
  // darwin needs -undefined dynamic_lookup to allow that, ELF allows it by
  // default. The load test after the link turns "this LLVM cannot host
  // plugins" into one clear error instead of one per translation unit.
  const dynamicLookup = cfg.host.os === "darwin" ? " -Wl,-undefined,dynamic_lookup" : "";
  n.rule("clang_plugin", {
    command:
      `${q(cfg.hostCxx)} $flags -MMD -MT $out -MF $out.d -shared${dynamicLookup} -o $out $in` +
      ` && (${q(cfg.cxx)} -fplugin=$out -fsyntax-only -x c++ /dev/null` +
      ` || (echo "${PLUGIN_NAME}: the plugin does not load into ${cfg.cxx}; build with --exceptionLint=off" >&2 && exit 1))`,
    description: "clang-plugin $out",
    depfile: "$out.d",
    deps: "gcc",
  });
}

/**
 * Emit the plugin build edge. Returns the flags and implicit inputs every
 * cxx edge of bun's own sources needs, or undefined when the lint is off.
 */
export function emitExceptionLint(n: Ninja, cfg: Config): ExceptionLintOpts | undefined {
  if (!cfg.exceptionLint) return undefined;
  assert(cfg.llvmDevDir !== undefined, "exceptionLint is on without an LLVM dev dir (resolveConfig checks this)");

  const plugin = exceptionLintPluginPath(cfg);
  const data = lintDataFiles(cfg.cwd);

  // Output dirs are created at configure time, like the object dirs
  // (configure.ts mkdirAll only sees output.objects).
  mkdirSync(dirname(plugin), { recursive: true });

  n.comment("─── jsc-exception-lint plugin ───");
  n.blank();
  n.build({
    outputs: [plugin],
    rule: "clang_plugin",
    inputs: [lintSource(cfg.cwd)],
    vars: {
      // Same flags as run.ts uses for the standalone tool, plus -fPIC and the
      // plugin define. -fno-rtti/-fno-exceptions are what LLVM itself is
      // built with (`llvm-config --cxxflags`); code that subclasses its
      // types has to agree.
      flags: [
        "-std=c++17",
        "-O2",
        "-fno-rtti",
        "-fno-exceptions",
        "-fPIC",
        `-I${cfg.llvmDevDir}/include`,
        "-D_GNU_SOURCE",
        "-D__STDC_CONSTANT_MACROS",
        "-D__STDC_FORMAT_MACROS",
        "-D__STDC_LIMIT_MACROS",
        "-DJSC_EXCEPTION_LINT_PLUGIN",
      ].join(" "),
    },
  });
  n.phony(`${PLUGIN_NAME}-plugin`, [plugin]);

  // Digest of everything the plugin reads that ccache does not see. The
  // plugin source is included too, so a rebuilt plugin misses the cache even
  // if ccache's own hashing of -fplugin= files is ever turned off.
  const hash = createHash("sha256");
  for (const file of exceptionLintConfigureInputs(cfg.cwd)) {
    assert(existsSync(file), `jsc-exception-lint input missing: ${relative(cfg.cwd, file)}`, {
      hint: "The summaries are generated by `bun scripts/jsc-exception-lint/run.ts --update-summaries`; the other files are committed.",
    });
    hash.update(relative(cfg.cwd, file));
    hash.update(readFileSync(file));
  }
  const dataHash = hash.digest("hex").slice(0, 16);

  // Every path is relative to the build dir, where ninja runs the compiler,
  // so the command line is identical in every checkout (ccache shares
  // entries across worktrees through CCACHE_BASEDIR; an absolute path here
  // would undo that). The plugin resolves `root` itself.
  const rel = (p: string) => relative(cfg.buildDir, p);
  const pluginArg = (arg: string) => ["-Xclang", `-plugin-arg-${PLUGIN_NAME}`, "-Xclang", arg];
  const flags = [
    `-fplugin=${rel(plugin)}`,
    ...pluginArg(`root=${rel(cfg.cwd)}`),
    ...pluginArg(`nothrow=${rel(data.nothrow)}`),
    ...data.summaries.flatMap(s => pluginArg(`import=${rel(s)}`)),
    ...pluginArg(`baseline=${rel(data.baseline)}`),
    ...pluginArg("werror"),
    ...pluginArg(`data-hash=${dataHash}`),
  ];

  return {
    flags,
    implicitInputs: [plugin, data.nothrow, ...data.summaries, data.baseline],
  };
}
