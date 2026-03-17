/**
 * Code generation as ninja rules.
 *
 * Each codegen step is a single ninja `build` statement with explicit
 * inputs (script + sources) and outputs. All rules set `restat = 1` —
 * most codegen scripts use `writeIfNotChanged`, so downstream is pruned
 * when output content didn't change.
 *
 * Source lists come from `cmake/Sources.json` patterns, globbed once at
 * configure time via `globAllSources()` — see sources.ts. The expanded
 * paths are baked into build.ninja; adding a file picks up on next configure.
 *
 * bindgenv2 is special: its output set is dynamic (depends on which types
 * the .bindv2.ts files export). We invoke it with `--command=list-outputs`
 * at CONFIGURE time to get the actual output paths.
 *
 * ## Undeclared outputs
 *
 * Several scripts emit MORE files than they report:
 *   - bindgen.ts emits Generated<Name>.h per namespace (only .cpp declared)
 *   - bindgenv2 emits Generated<Type>.h per type (list-outputs skips .h)
 *   - generate-node-errors.ts emits ErrorCode.d.ts (not declared)
 *   - bundle-modules.ts emits eval/ subdir, BunBuiltinNames+extras.h, etc.
 *   - cppbind.ts emits cpp.source-links
 *
 * It WORKS because:
 *   1. The declared .cpp outputs guarantee the step runs before compile
 *   2. Compilation emits .d depfiles that track the .h files for NEXT build
 *   3. PCH order-depends on ALL codegen outputs; every cxx() waits on PCH
 *      → all codegen completes before any compile, undeclared .h exist
 *
 * Fixing properly (declaring all outputs) would require patching the
 * src/codegen/ scripts to report everything — changing contract with
 * existing tooling.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import type { Config } from "./config.ts";
import { BuildError, assert } from "./error.ts";
import { writeIfChanged } from "./fs.ts";
import type { Ninja } from "./ninja.ts";
import { quote, quoteArgs } from "./shell.ts";
import type { Sources } from "./sources.ts";

/**
 * Codegen outputs that land in `src/` instead of `codegenDir`. The zig
 * compiler refuses to import files outside its source tree, so these two
 * generated `.zig` files live in `src/bun.js/bindings/` (gitignored).
 *
 * Consumers of `sources.zig` (the `src/**\/*.zig` glob) must filter these
 * out — they're OUTPUTS of codegen, not inputs. bun.ts does this before
 * passing the zig list to emitZig().
 *
 * Paths are relative to repo root. This list is the single source of truth;
 * `globAllSources()` does NOT hardcode these.
 */
export const zigFilesGeneratedIntoSrc = [
  "src/bun.js/bindings/GeneratedBindings.zig",
  "src/bun.js/bindings/GeneratedJS2Native.zig",
] as const;

// The individual emit functions take these four params. Bundled to keep
// signatures short.
interface Ctx {
  n: Ninja;
  cfg: Config;
  sources: Sources;
  o: CodegenOutputs;
  dirStamp: string;
}

/**
 * Read a package.json and return the list of dependency package.json paths
 * under node_modules/. Used as outputs of `bun install` — if any are missing,
 * install re-runs.
 */
function readPackageDeps(pkgDir: string): string[] {
  const pkgPath = resolve(pkgDir, "package.json");
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as typeof pkg;
  } catch (cause) {
    throw new BuildError(`Could not parse package.json`, { file: pkgPath, cause });
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const nodeModules = resolve(pkgDir, "node_modules");
  return Object.keys(deps).map(name => resolve(nodeModules, name, "package.json"));
}

// ───────────────────────────────────────────────────────────────────────────
// Ninja rule registration
// ───────────────────────────────────────────────────────────────────────────

/**
 * Register ninja rules shared by all codegen steps. Call once before
 * emitCodegen().
 */
export function registerCodegenRules(n: Ninja, cfg: Config): void {
  // Shell syntax: HOST platform, not target. zig-only cross-compiles on
  // a linux box for darwin/windows; these rules run on the linux box.
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  const bun = q(cfg.bun);
  const esbuild = q(cfg.esbuild);

  // Generic codegen: `cd <repo-root> && [env VARS] bun <args>`.
  // Both `bun run script.ts` and `bun script.ts` go through this — the
  // caller puts the `run` subcommand in $args when needed.
  //
  // restat = 1 because most scripts use writeIfNotChanged(). Scripts that
  // don't (generate-jssink, ci_info) always write → restat is a no-op for
  // them, no harm.
  n.rule("codegen", {
    command: hostWin ? `cmd /c "cd /d $cwd && ${bun} $args"` : `cd $cwd && ${bun} $args`,
    description: "gen $desc",
    restat: true,
  });

  // esbuild invocations. No restat — esbuild always touches outputs.
  // No pool — esbuild is fast and single-threaded per bundle.
  n.rule("esbuild", {
    command: hostWin ? `cmd /c "cd /d $cwd && ${esbuild} $args"` : `cd $cwd && ${esbuild} $args`,
    description: "esbuild $desc",
  });

  // bun install. Inputs: package.json + bun.lock. Outputs: a stamp file we
  // touch on success, plus each node_modules/<dep>/package.json as IMPLICIT
  // outputs (so deleting node_modules/ correctly retriggers install).
  //
  // Why stamp + restat instead of just the node_modules paths as outputs:
  // `bun install --frozen-lockfile` with no changes doesn't touch anything.
  // If package.json was edited at time T and install ran at T-1day, the
  // node_modules files have mtimes from T-1day < T → ninja loops forever.
  // Touching the stamp gives ninja something with mtime T to compare against.
  // Restat lets implicit outputs keep their old mtimes, pruning downstream.
  //
  // CMake only tracked package.json as input; we add bun.lock so lockfile
  // version bumps actually reinstall.
  const touch = hostWin ? "type nul >" : "touch";
  n.rule("bun_install", {
    command: hostWin
      ? `cmd /c "cd /d $dir && ${bun} install --frozen-lockfile && ${touch} $stamp"`
      : `cd $dir && ${bun} install --frozen-lockfile && ${touch} $stamp`,
    description: "install $dir",
    restat: true,
    // bun install can be memory-hungry and grabs a lockfile; serialize.
    pool: "bun_install",
  });
  n.pool("bun_install", 1);

  // Codegen dir stamp — all outputs go into cfg.codegenDir, but the dir must
  // exist first. Scripts generally mkdir themselves, but some (esbuild) don't.
  n.build({
    outputs: [codegenDirStamp(cfg)],
    rule: "mkdir_stamp",
    inputs: [],
    vars: { dir: n.rel(cfg.codegenDir) },
  });

  // Stamps dir — holds bun_install stamp files.
  const stampsDir = resolve(cfg.buildDir, "stamps");
  n.build({
    outputs: [resolve(stampsDir, ".dir")],
    rule: "mkdir_stamp",
    inputs: [],
    vars: { dir: n.rel(stampsDir) },
  });
}

function codegenDirStamp(cfg: Config): string {
  return resolve(cfg.codegenDir, ".dir");
}

// ───────────────────────────────────────────────────────────────────────────
// Codegen step emitters
// ───────────────────────────────────────────────────────────────────────────

/**
 * All codegen outputs, grouped by consumer. Downstream phases (cpp compile,
 * zig build, link) add the appropriate group to their implicit inputs.
 */
export interface CodegenOutputs {
  /** All codegen outputs — use for phony target `codegen`. */
  all: string[];

  /** Outputs that zig `@embedFile`s or imports. */
  zigInputs: string[];

  /** Outputs that zig needs to exist but doesn't embed (debug bake runtime). */
  zigOrderOnly: string[];

  /** Generated .cpp files. Compiled alongside handwritten C++ in bun.ts. */
  cppSources: string[];

  /**
   * Generated headers that are #included by hand-written .cpp files.
   * The PCH order-depends on all of these, and cxx waits on PCH — so
   * they're guaranteed to exist before any compile. Depfile tracking
   * handles subsequent changes.
   */
  cppHeaders: string[];

  /**
   * ALL cpp-relevant codegen outputs — the union of cppHeaders, cppSources,
   * bindgenV2Cpp. cxx compilation order-depends on THIS (not `all`): cxx
   * doesn't need bake.*.js, cpp.zig, runtime.out.js, or any other zig-only
   * outputs. Using `all` would pull bake-codegen in cpp-only CI mode, which
   * fails on old CI bun versions (bake-codegen shells out to `bun build`
   * whose CSS url() handling changed between versions). cmake only wired
   * bake outputs into BUN_ZIG_GENERATED_SOURCES, never C++ deps — same here.
   *
   * The "undeclared .h files" issue (some scripts emit .h alongside their
   * declared outputs): those steps also emit a .cpp or .h that IS declared
   * here, so they still run before any cxx compile.
   */
  cppAll: string[];

  /** The bindgenv2 .cpp outputs (compiled separately from handwritten C++). */
  bindgenV2Cpp: string[];

  /** The bindgenv2 .zig outputs (imported by the zig build). */
  bindgenV2Zig: string[];

  /**
   * Stamp output from `bun install` at repo root.
   * The esbuild tool and the cppbind lezer parser live here. Any
   * step that uses esbuild (or imports node_modules deps at configure
   * time) depends on this.
   */
  rootInstall: string;
}

/**
 * Emit all codegen steps. Returns grouped outputs for downstream wiring.
 *
 * Call after registerCodegenRules() and after registerDirStamps() (we use
 * the `mkdir_stamp` rule for the codegen dir).
 */
export function emitCodegen(n: Ninja, cfg: Config, sources: Sources): CodegenOutputs {
  n.comment("─── Codegen ───");
  n.blank();

  const dirStamp = codegenDirStamp(cfg);

  // ─── Root bun install (provides esbuild + lezer-cpp for cppbind) ───
  const rootInstall = emitBunInstall(n, cfg, cfg.cwd);

  const o: CodegenOutputs = {
    all: [],
    zigInputs: [],
    zigOrderOnly: [],
    cppSources: [],
    cppHeaders: [],
    cppAll: [],
    bindgenV2Cpp: [],
    bindgenV2Zig: [],
    rootInstall,
  };

  const ctx: Ctx = { n, cfg, sources, o, dirStamp };

  emitBunError(ctx);
  emitFallbackDecoder(ctx);
  emitRuntimeJs(ctx);
  emitNodeFallbacks(ctx);
  emitErrorCode(ctx);
  emitGeneratedClasses(ctx);
  emitCppBind(ctx);
  emitCiInfo(ctx);
  emitJsModules(ctx);
  emitBakeCodegen(ctx);
  emitBindgenV2(ctx);
  emitBindgen(ctx);
  emitJsSink(ctx);
  emitObjectLuts(ctx);

  n.phony("codegen", o.all);
  n.blank();

  // Assemble cppAll — the cxx-relevant subset. See field docstring.
  o.cppAll = [...new Set([...o.cppHeaders, ...o.cppSources, ...o.bindgenV2Cpp])];

  return o;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Emit a `bun install` step for a package directory. Returns the stamp file
 * path — use it as an implicit input on anything that needs node_modules/.
 *
 * The stamp is the explicit output; each node_modules/<dep>/package.json is
 * an implicit output (so deleting node_modules/ correctly retriggers install,
 * and restat prunes downstream when install was a no-op).
 */
function emitBunInstall(n: Ninja, cfg: Config, pkgDir: string): string {
  const depPackageJsons = readPackageDeps(pkgDir);
  assert(depPackageJsons.length > 0, `package.json has no dependencies: ${pkgDir}/package.json`);

  const pkgJson = resolve(pkgDir, "package.json");
  const lockfile = resolve(pkgDir, "bun.lock");
  // bun.lock is optional (some packages might not have one yet), but if it
  // exists it MUST be an input — lockfile bumps reinstall.
  const inputs = [pkgJson];
  try {
    readFileSync(lockfile); // exists check
    inputs.push(lockfile);
  } catch {
    // no lockfile, that's fine
  }

  // Stamp lives in the build dir, not the package dir — keeps the source
  // tree clean and makes `rm -rf build/` fully reset install state.
  // Uniqueify by hashing the package dir path (multiple installs possible).
  const stampName = pkgDir.replace(/[^A-Za-z0-9]+/g, "_");
  const stamp = resolve(cfg.buildDir, "stamps", `install_${stampName}.stamp`);

  n.build({
    outputs: [stamp],
    implicitOutputs: depPackageJsons,
    rule: "bun_install",
    inputs,
    orderOnlyInputs: [resolve(cfg.buildDir, "stamps", ".dir")],
    // stamp must be absolute — the command `cd $dir && ... && touch $stamp`
    // runs from $dir, not from buildDir. n.rel() would break that.
    vars: { dir: pkgDir, stamp },
  });

  return stamp;
}

/**
/** `--debug=ON` / `--debug=OFF` flag used by several scripts. */
function debugFlag(cfg: Config): string {
  return cfg.debug ? "--debug=ON" : "--debug=OFF";
}

/**
 * Shell-quote args for a codegen rule command string. These rules wrap in
 * `cmd /c` on a Windows HOST, so quoting follows the host shell.
 */
function shJoin(cfg: Config, args: string[]): string {
  return quoteArgs(args, cfg.host.os === "windows");
}

// ───────────────────────────────────────────────────────────────────────────
// Individual step emitters
// ───────────────────────────────────────────────────────────────────────────

function emitBunError({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const sourceDir = resolve(cfg.cwd, "packages", "bun-error");
  const installStamp = emitBunInstall(n, cfg, sourceDir);

  const outDir = resolve(cfg.codegenDir, "bun-error");
  const outputs = [resolve(outDir, "index.js"), resolve(outDir, "bun-error.css")];

  n.build({
    outputs,
    rule: "esbuild",
    inputs: sources.bunError,
    // Install stamp as implicit — changing preact version re-bundles.
    // Root install as well (esbuild tool lives there).
    implicitInputs: [installStamp, o.rootInstall],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: sourceDir,
      desc: "bun-error",
      args: shJoin(cfg, [
        "index.tsx",
        "bun-error.css",
        `--outdir=${outDir}`,
        `--define:process.env.NODE_ENV="production"`,
        "--minify",
        "--bundle",
        "--platform=browser",
        "--format=esm",
      ]),
    },
  });

  o.all.push(...outputs);
  o.zigInputs.push(...outputs);
}

function emitFallbackDecoder({ n, cfg, o, dirStamp }: Ctx): void {
  const src = resolve(cfg.cwd, "src", "fallback.ts");
  const out = resolve(cfg.codegenDir, "fallback-decoder.js");

  n.build({
    outputs: [out],
    rule: "esbuild",
    inputs: [src],
    implicitInputs: [o.rootInstall],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "fallback-decoder.js",
      args: shJoin(cfg, [
        src,
        `--outfile=${out}`,
        "--target=esnext",
        "--bundle",
        "--format=iife",
        "--platform=browser",
        "--minify",
      ]),
    },
  });

  o.all.push(out);
  o.zigInputs.push(out);
}

function emitRuntimeJs({ n, cfg, o, dirStamp }: Ctx): void {
  const src = resolve(cfg.cwd, "src", "runtime.bun.js");
  const out = resolve(cfg.codegenDir, "runtime.out.js");

  n.build({
    outputs: [out],
    rule: "esbuild",
    inputs: [src],
    implicitInputs: [o.rootInstall],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "runtime.out.js",
      args: shJoin(cfg, [
        src,
        `--outfile=${out}`,
        `--define:process.env.NODE_ENV="production"`,
        "--target=esnext",
        "--bundle",
        "--format=esm",
        "--platform=node",
        "--minify",
        "--external:/bun:*",
      ]),
    },
  });

  o.all.push(out);
  o.zigInputs.push(out);
}

function emitNodeFallbacks({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const sourceDir = resolve(cfg.cwd, "src", "node-fallbacks");
  const installStamp = emitBunInstall(n, cfg, sourceDir);

  const outDir = resolve(cfg.codegenDir, "node-fallbacks");
  // One output per source, same basename.
  const outputs = sources.nodeFallbacks.map(s => resolve(outDir, basename(s)));

  // The script (build-fallbacks.ts) reads its args as [outdir, ...sources]
  // but actually ignores the sources — it does readdirSync(".") to discover
  // files. We pass them anyway so ninja tracks them as inputs.
  const script = resolve(sourceDir, "build-fallbacks.ts");
  n.build({
    outputs,
    rule: "codegen",
    inputs: [script, ...sources.nodeFallbacks],
    implicitInputs: [installStamp],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: sourceDir,
      desc: "node-fallbacks/*.js",
      // `bun run build-fallbacks` resolves to `./build-fallbacks.ts` in cwd
      args: shJoin(cfg, ["run", "build-fallbacks", outDir, ...sources.nodeFallbacks]),
    },
  });

  o.all.push(...outputs);
  o.zigInputs.push(...outputs);

  // ─── react-refresh (separate bundle, uses node-fallbacks' node_modules) ───
  const rrSrc = resolve(sourceDir, "node_modules", "react-refresh", "cjs", "react-refresh-runtime.development.js");
  const rrOut = resolve(outDir, "react-refresh.js");
  n.build({
    outputs: [rrOut],
    rule: "codegen",
    inputs: [resolve(sourceDir, "package.json"), resolve(sourceDir, "bun.lock")],
    implicitInputs: [installStamp],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: sourceDir,
      desc: "node-fallbacks/react-refresh.js",
      args: shJoin(cfg, [
        "build",
        rrSrc,
        `--outfile=${rrOut}`,
        "--target=browser",
        "--format=cjs",
        "--minify",
        `--define:process.env.NODE_ENV="development"`,
      ]),
    },
  });

  o.all.push(rrOut);
  o.zigInputs.push(rrOut);
}

function emitErrorCode({ n, cfg, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "generate-node-errors.ts");
  const inputs = [
    script,
    resolve(cfg.cwd, "src", "bun.js", "bindings", "ErrorCode.ts"),
    // ErrorCode.cpp/.h are listed in CMake but the script doesn't read them;
    // they're there so changes to the handwritten side (e.g. new error
    // category added to the C++ enum) invalidate this step. We include them
    // for the same reason.
    resolve(cfg.cwd, "src", "bun.js", "bindings", "ErrorCode.cpp"),
    resolve(cfg.cwd, "src", "bun.js", "bindings", "ErrorCode.h"),
  ];

  const outputs = [
    resolve(cfg.codegenDir, "ErrorCode+List.h"),
    resolve(cfg.codegenDir, "ErrorCode+Data.h"),
    resolve(cfg.codegenDir, "ErrorCode.zig"),
  ];

  n.build({
    outputs,
    rule: "codegen",
    inputs,
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "ErrorCode.{zig,h}",
      args: shJoin(cfg, ["run", script, cfg.codegenDir]),
    },
  });

  o.all.push(...outputs);
  o.zigInputs.push(...outputs);
  o.cppHeaders.push(outputs[0]!, outputs[1]!);
}

function emitGeneratedClasses({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "generate-classes.ts");

  const outputs = [
    resolve(cfg.codegenDir, "ZigGeneratedClasses.h"),
    resolve(cfg.codegenDir, "ZigGeneratedClasses.cpp"),
    resolve(cfg.codegenDir, "ZigGeneratedClasses+lazyStructureHeader.h"),
    resolve(cfg.codegenDir, "ZigGeneratedClasses+DOMClientIsoSubspaces.h"),
    resolve(cfg.codegenDir, "ZigGeneratedClasses+DOMIsoSubspaces.h"),
    resolve(cfg.codegenDir, "ZigGeneratedClasses+lazyStructureImpl.h"),
    resolve(cfg.codegenDir, "ZigGeneratedClasses.zig"),
    resolve(cfg.codegenDir, "ZigGeneratedClasses.lut.txt"),
  ];

  n.build({
    outputs,
    rule: "codegen",
    inputs: [script, ...sources.zigGeneratedClasses],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "ZigGeneratedClasses.{zig,cpp,h}",
      args: shJoin(cfg, ["run", script, ...sources.zigGeneratedClasses, cfg.codegenDir]),
    },
  });

  o.all.push(...outputs);
  o.zigInputs.push(...outputs);
  o.cppSources.push(outputs[1]!); // .cpp
  o.cppHeaders.push(outputs[0]!, outputs[2]!, outputs[3]!, outputs[4]!, outputs[5]!); // .h files
  // .lut.txt is consumed by emitObjectLuts below
}

function emitCppBind({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "cppbind.ts");

  const output = resolve(cfg.codegenDir, "cpp.zig");

  // Write the .cpp file list for cppbind to scan. Build system owns the
  // glob (sources.ts reads Sources.json); we hand the result to cppbind
  // as an explicit input instead of it reading a magic hardcoded path.
  // Relative paths, forward slashes — same format cppbind expects.
  //
  // Written at CONFIGURE time (not via a ninja rule): it's a derived
  // manifest from our glob, and we want writeIfChanged semantics so a
  // stable .cpp set → unchanged mtime → ninja doesn't re-run cppbind.
  // codegenDir may not exist yet on first configure — mkdir it.
  mkdirSync(cfg.codegenDir, { recursive: true });
  const cxxSourcesFile = resolve(cfg.codegenDir, "cxx-sources.txt");
  const cxxSourcesLines = sources.cxx.map(p => relative(cfg.cwd, p).replace(/\\/g, "/"));
  writeIfChanged(cxxSourcesFile, cxxSourcesLines.join("\n") + "\n");

  n.build({
    outputs: [output],
    rule: "codegen",
    inputs: [script],
    // cppbind scans ALL .cpp files for [[ZIG_EXPORT]] annotations. Every
    // .cpp is an implicit input so changing an annotation retriggers.
    // ~540 files — ninja handles this fine via .ninja_deps stat caching.
    // cxxSourcesFile also listed — if the list itself changes (file
    // added/removed), that's a different input set.
    implicitInputs: [
      cxxSourcesFile,
      ...sources.cxx,
      ...sources.jsCodegen,
      // cppbind auto-runs `bun install` for its lezer-cpp dep if needed,
      // but depending on root install ensures that already happened on
      // first build (and catches lezer version bumps).
      o.rootInstall,
    ],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "cpp.zig (cppbind)",
      // cppbind.ts takes: <srcdir> <codegendir> <cxx-sources>. No `run` —
      // direct script invocation (`${BUN_EXECUTABLE} ${script} ...`).
      args: shJoin(cfg, [script, resolve(cfg.cwd, "src"), cfg.codegenDir, cxxSourcesFile]),
    },
  });

  o.all.push(output);
  o.zigInputs.push(output);
}

function emitCiInfo({ n, cfg, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "ci_info.ts");
  const output = resolve(cfg.codegenDir, "ci_info.zig");

  // CMake lists JavaScriptCodegenSources as deps here, but ci_info.ts doesn't
  // read any of those files — it's a pure static data generator. The CMake
  // dep list is wrong (copy-paste from bundle-modules). We use just the script.
  n.build({
    outputs: [output],
    rule: "codegen",
    inputs: [script],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "ci_info.zig",
      args: shJoin(cfg, [script, output]),
    },
  });

  o.all.push(output);
  o.zigInputs.push(output);
}

function emitJsModules({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "bundle-modules.ts");

  // InternalModuleRegistry.cpp is read by the script (for a sanity check).
  const extraInput = resolve(cfg.cwd, "src", "bun.js", "bindings", "InternalModuleRegistry.cpp");

  // Written into src/ (not codegenDir) — see zigFilesGeneratedIntoSrc at top.
  const js2nativeZig = resolve(cfg.cwd, zigFilesGeneratedIntoSrc[1]);

  const outputs = [
    resolve(cfg.codegenDir, "WebCoreJSBuiltins.cpp"),
    resolve(cfg.codegenDir, "WebCoreJSBuiltins.h"),
    resolve(cfg.codegenDir, "InternalModuleRegistryConstants.h"),
    resolve(cfg.codegenDir, "InternalModuleRegistry+createInternalModuleById.h"),
    resolve(cfg.codegenDir, "InternalModuleRegistry+enum.h"),
    resolve(cfg.codegenDir, "InternalModuleRegistry+numberOfModules.h"),
    resolve(cfg.codegenDir, "NativeModuleImpl.h"),
    resolve(cfg.codegenDir, "ResolvedSourceTag.zig"),
    resolve(cfg.codegenDir, "SyntheticModuleType.h"),
    resolve(cfg.codegenDir, "GeneratedJS2Native.h"),
    js2nativeZig,
  ];

  n.build({
    outputs,
    rule: "codegen",
    inputs: [script, ...sources.js, ...sources.jsCodegen, extraInput],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "JS modules (bundle-modules)",
      // Note: arg is BUILD_PATH (buildDir), not CODEGEN_PATH. The script
      // derives CODEGEN_DIR = join(BUILD_PATH, "codegen") internally.
      args: shJoin(cfg, ["run", script, debugFlag(cfg), cfg.buildDir]),
    },
  });

  o.all.push(...outputs);
  o.zigInputs.push(...outputs);
  o.cppSources.push(outputs[0]!); // WebCoreJSBuiltins.cpp
  o.cppHeaders.push(...outputs.filter(p => p.endsWith(".h")));
}

function emitBakeCodegen({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "bake-codegen.ts");

  // InternalModuleRegistry.cpp is listed as a dep in CMake for this step too.
  // The script doesn't read it; CMake copy-paste. We skip it.

  // CMake only declares bake.client.js and bake.server.js as outputs. The
  // script also emits bake.error.js (build.zig embeds it). We declare
  // all three.
  //
  // Debug uses order-only deps on these .js files (loaded at runtime,
  // no need to relink zig on change). Release uses implicit (embedded
  // via @embedFile, must relink).
  const outputs = [
    resolve(cfg.codegenDir, "bake.client.js"),
    resolve(cfg.codegenDir, "bake.server.js"),
    resolve(cfg.codegenDir, "bake.error.js"),
  ];

  n.build({
    outputs,
    rule: "codegen",
    inputs: [script, ...sources.bakeRuntime],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "bake.{client,server,error}.js",
      args: shJoin(cfg, ["run", script, debugFlag(cfg), `--codegen-root=${cfg.codegenDir}`]),
    },
  });

  o.all.push(...outputs);
  // Debug: read at RUNTIME (not embedded) → zig only needs existence.
  // Release: embedded via @embedFile → content changes must rebuild zig.
  if (cfg.debug) {
    o.zigOrderOnly.push(...outputs);
  } else {
    o.zigInputs.push(...outputs);
  }
}

function emitBindgenV2({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "bindgenv2", "script.ts");

  // The script's output set depends on which NamedTypes the .bindv2.ts files
  // export. We run `--command=list-outputs` SYNCHRONOUSLY at configure time
  // to get the real list. This is a configure-time dependency on bun +
  // sources — same tradeoff CMake makes with execute_process().
  //
  // If list-outputs fails (e.g. syntax error in a .bindv2.ts file), we fail
  // configure immediately with a clear error. Better to catch that here than
  // get a cryptic "multiple rules generate <unknown>" from ninja.
  const sourcesArg = sources.bindgenV2.join(",");
  const listResult = spawnSync(
    cfg.bun,
    ["run", script, "--command=list-outputs", `--sources=${sourcesArg}`, `--codegen-path=${cfg.codegenDir}`],
    { cwd: cfg.cwd, encoding: "utf8" },
  );
  if (listResult.status !== 0) {
    throw new BuildError(`bindgenv2 list-outputs failed (exit ${listResult.status})`, {
      file: script,
      hint: listResult.stderr?.trim(),
    });
  }
  // Output is semicolon-separated (CMake list format).
  const allOutputs = listResult.stdout
    .trim()
    .split(";")
    .filter(p => p.length > 0);

  assert(allOutputs.length > 0, "bindgenv2 list-outputs returned no files");

  const cppOutputs = allOutputs.filter(p => p.endsWith(".cpp"));
  const zigOutputs = allOutputs.filter(p => p.endsWith(".zig"));
  const other = allOutputs.filter(p => !p.endsWith(".cpp") && !p.endsWith(".zig"));
  assert(other.length === 0, `bindgenv2 emitted unexpected output type: ${other.join(", ")}`);

  n.build({
    outputs: allOutputs,
    rule: "codegen",
    inputs: [script, ...sources.bindgenV2, ...sources.bindgenV2Internal],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "bindgenv2",
      args: shJoin(cfg, [
        "run",
        script,
        "--command=generate",
        `--codegen-path=${cfg.codegenDir}`,
        `--sources=${sourcesArg}`,
      ]),
    },
  });

  o.all.push(...allOutputs);
  o.bindgenV2Cpp.push(...cppOutputs);
  o.bindgenV2Zig.push(...zigOutputs);
  o.zigInputs.push(...zigOutputs);
}

function emitBindgen({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "bindgen.ts");

  // Written into src/ (not codegenDir) — see zigFilesGeneratedIntoSrc at top.
  const zigOut = resolve(cfg.cwd, zigFilesGeneratedIntoSrc[0]);
  const cppOut = resolve(cfg.codegenDir, "GeneratedBindings.cpp");

  // bindgen.ts scans src/ for .bind.ts files itself — this list is only for
  // ninja dependency tracking. New .bind.ts files need a reconfigure to be
  // picked up (next glob gets them).
  n.build({
    outputs: [cppOut, zigOut],
    rule: "codegen",
    inputs: [script, ...sources.bindgen],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: ".bind.ts → GeneratedBindings.{cpp,zig}",
      args: shJoin(cfg, ["run", script, debugFlag(cfg), `--codegen-root=${cfg.codegenDir}`]),
    },
  });

  o.all.push(cppOut, zigOut);
  o.cppSources.push(cppOut);
  o.zigInputs.push(zigOut);
}

function emitJsSink({ n, cfg, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "generate-jssink.ts");
  const hashTableScript = resolve(cfg.cwd, "src", "codegen", "create-hash-table.ts");
  const perlScript = resolve(cfg.cwd, "src", "codegen", "create_hash_table");

  // generate-jssink.ts writes JSSink.{cpp,h,lut.txt}, then internally spawns
  // create-hash-table.ts to convert .lut.txt → .lut.h. So all four are outputs
  // of this one step (though .lut.txt is really an intermediate — we don't
  // expose it).
  const outputs = [
    resolve(cfg.codegenDir, "JSSink.cpp"),
    resolve(cfg.codegenDir, "JSSink.h"),
    resolve(cfg.codegenDir, "JSSink.lut.h"),
  ];

  n.build({
    outputs,
    rule: "codegen",
    inputs: [script, hashTableScript, perlScript],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "JSSink.{cpp,h,lut.h}",
      args: shJoin(cfg, ["run", script, cfg.codegenDir]),
    },
  });

  o.all.push(...outputs);
  o.cppSources.push(outputs[0]!); // .cpp
  o.cppHeaders.push(outputs[1]!, outputs[2]!); // .h + .lut.h
}

/**
 * LUT sources → .lut.h outputs. One build statement PER pair, because the
 * script takes a single (src, out) pair.
 *
 * The source .cpp files contain `@begin XXXTable ... @end` blocks that the
 * perl script parses into JSC HashTableValue arrays. The TS wrapper adds
 * platform-specific #if preprocessing via TARGET_PLATFORM env var.
 */
function emitObjectLuts({ n, cfg, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "create-hash-table.ts");
  const perlScript = resolve(cfg.cwd, "src", "codegen", "create_hash_table");

  // (source, output) pairs. ZigGeneratedClasses.lut.txt is special: it's
  // GENERATED by emitGeneratedClasses, so it's in codegenDir not src/.
  const pairs: [src: string, out: string][] = [
    [resolve(cfg.cwd, "src/bun.js/bindings/BunObject.cpp"), resolve(cfg.codegenDir, "BunObject.lut.h")],
    [resolve(cfg.cwd, "src/bun.js/bindings/ZigGlobalObject.lut.txt"), resolve(cfg.codegenDir, "ZigGlobalObject.lut.h")],
    [resolve(cfg.cwd, "src/bun.js/bindings/JSBuffer.cpp"), resolve(cfg.codegenDir, "JSBuffer.lut.h")],
    [resolve(cfg.cwd, "src/bun.js/bindings/BunProcess.cpp"), resolve(cfg.codegenDir, "BunProcess.lut.h")],
    [
      resolve(cfg.cwd, "src/bun.js/bindings/ProcessBindingBuffer.cpp"),
      resolve(cfg.codegenDir, "ProcessBindingBuffer.lut.h"),
    ],
    [
      resolve(cfg.cwd, "src/bun.js/bindings/ProcessBindingConstants.cpp"),
      resolve(cfg.codegenDir, "ProcessBindingConstants.lut.h"),
    ],
    [resolve(cfg.cwd, "src/bun.js/bindings/ProcessBindingFs.cpp"), resolve(cfg.codegenDir, "ProcessBindingFs.lut.h")],
    [
      resolve(cfg.cwd, "src/bun.js/bindings/ProcessBindingNatives.cpp"),
      resolve(cfg.codegenDir, "ProcessBindingNatives.lut.h"),
    ],
    [
      resolve(cfg.cwd, "src/bun.js/bindings/ProcessBindingHTTPParser.cpp"),
      resolve(cfg.codegenDir, "ProcessBindingHTTPParser.lut.h"),
    ],
    [resolve(cfg.cwd, "src/bun.js/modules/NodeModuleModule.cpp"), resolve(cfg.codegenDir, "NodeModuleModule.lut.h")],
    [resolve(cfg.codegenDir, "ZigGeneratedClasses.lut.txt"), resolve(cfg.codegenDir, "ZigGeneratedClasses.lut.h")],
    [resolve(cfg.cwd, "src/bun.js/bindings/webcore/JSEvent.cpp"), resolve(cfg.codegenDir, "JSEvent.lut.h")],
  ];

  // create-hash-table.ts reads TARGET_PLATFORM env with process.platform
  // fallback. We don't set it — cmake never did either. The preprocessing
  // is OS-based (#if OS(WINDOWS) etc.) not arch-based, and bun only
  // cross-compiles across arch on the same OS, so host platform == target
  // OS. If cross-OS builds are ever added, thread the platform through
  // argv here rather than shell env (which isn't portable to cmd.exe).
  for (const [src, out] of pairs) {
    n.build({
      outputs: [out],
      rule: "codegen",
      inputs: [src],
      implicitInputs: [script, perlScript],
      orderOnlyInputs: [dirStamp],
      vars: {
        cwd: cfg.cwd,
        desc: basename(out),
        args: shJoin(cfg, ["run", script, src, out]),
      },
    });
    o.all.push(out);
    o.cppHeaders.push(out);
  }
}
