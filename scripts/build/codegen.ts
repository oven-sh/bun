/**
 * Code generation as ninja rules.
 *
 * Each codegen step is a single ninja `build` statement with explicit
 * inputs (script + sources) and outputs. All rules set `restat = 1` —
 * most codegen scripts use `writeIfNotChanged`, so downstream is pruned
 * when output content didn't change.
 *
 * Source lists come from the patterns in glob-sources.ts, globbed once at
 * configure time via `globAllSources()`. The expanded
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
import { basename, dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Sources } from "../glob-sources.ts";
import { generateBuildOptionsRs } from "./buildOptionsRs.ts";
import type { Config } from "./config.ts";
import { BuildError, assert } from "./error.ts";
import { writeIfChanged } from "./fs.ts";
import { generateJsonByteClass } from "./jsonByteClass.ts";
import type { Ninja } from "./ninja.ts";
import { quote, quoteArgs } from "./shell.ts";

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
 * Node-style platform/arch strings for the TARGET (not the host running
 * codegen). Passed as TARGET_PLATFORM/TARGET_ARCH so scripts that inline
 * `process.platform` into bundled JS use the target's value.
 */
function codegenTarget(cfg: Config): { platform: string; arch: string } {
  const platform =
    cfg.abi === "android"
      ? "android"
      : cfg.os === "darwin"
        ? "darwin"
        : cfg.os === "windows"
          ? "win32"
          : cfg.os === "freebsd"
            ? "freebsd"
            : "linux";
  const arch = cfg.x64 ? "x64" : "arm64";
  return { platform, arch };
}

export function registerCodegenRules(n: Ninja, cfg: Config): void {
  // Shell syntax: HOST platform, not target. rust-only cross-compiles on
  // a linux box for other linux/freebsd targets; these rules run on the host.
  const hostWin = cfg.host.os === "windows";
  const q = (p: string) => quote(p, hostWin);
  const esbuild = q(cfg.esbuild);
  const { platform, arch } = codegenTarget(cfg);

  // Generic codegen: `cd <repo-root> && [env VARS] <jsRuntime> <script> <args>`.
  // Scripts are node-compatible; when running under Node, the --import hook
  // (node-loader.ts) provides the tsconfig path mappings (bindgen/bindgenv2)
  // that *.bind.ts rely on. Bun resolves those via tsconfig natively so the
  // hook is a no-op there.
  //
  // TARGET_PLATFORM/ARCH: scripts that inline process.platform into the
  // bundled JS modules (replacements.ts, bundle-modules.ts,
  // create-hash-table.ts) read these so a cross-compiled binary doesn't
  // ship with the build host's platform baked in.
  //
  // restat = 1 because most scripts use writeIfNotChanged().
  const nodeLoader = q(pathToFileURL(resolve(cfg.cwd, "src", "codegen", "node-loader.ts")).href);
  const runtime = `${cfg.jsRuntime} --import ${nodeLoader}`;
  const env = hostWin
    ? `set TARGET_PLATFORM=${platform}&& set TARGET_ARCH=${arch}&& `
    : `TARGET_PLATFORM=${platform} TARGET_ARCH=${arch} `;
  n.rule("codegen", {
    command: hostWin ? `cmd /c "cd /d $cwd && ${env}${runtime} $args"` : `cd $cwd && ${env}${runtime} $args`,
    description: "gen $desc",
    restat: true,
  });

  // esbuild invocations. No restat — esbuild always touches outputs.
  // No pool — esbuild is fast and single-threaded per bundle.
  n.rule("esbuild", {
    command: hostWin ? `cmd /c "cd /d $cwd && ${esbuild} $args"` : `cd $cwd && ${esbuild} $args`,
    description: "esbuild $desc",
  });

  // Package install. Inputs: package.json + lockfile. Outputs: a stamp file
  // we touch on success, plus each node_modules/<dep>/package.json as
  // IMPLICIT outputs (so deleting node_modules/ correctly retriggers install).
  //
  // Why stamp + restat instead of just the node_modules paths as outputs:
  // a frozen install with no changes doesn't touch anything. If package.json
  // was edited at time T and install ran at T-1day, the node_modules files
  // have mtimes from T-1day < T → ninja loops forever. Touching the stamp
  // gives ninja something with mtime T to compare against. Restat lets
  // implicit outputs keep their old mtimes, pruning downstream.
  const touch = hostWin ? "type nul >" : "touch";
  const pm = q(cfg.packageManager.exe);
  const pmArgs = quoteArgs(cfg.packageManager.installArgs, hostWin);
  n.rule("pkg_install", {
    command: hostWin
      ? `cmd /c "cd /d $dir && ${pm} ${pmArgs} && ${touch} $stamp"`
      : `cd $dir && ${pm} ${pmArgs} && ${touch} $stamp`,
    description: "install $dir",
    restat: true,
    // install can be memory-hungry and grabs a lockfile; serialize.
    pool: "pkg_install",
  });
  n.pool("pkg_install", 1);

  // Codegen dir stamp — all outputs go into cfg.codegenDir, but the dir must
  // exist first. Scripts generally mkdir themselves, but some (esbuild) don't.
  n.build({
    outputs: [codegenDirStamp(cfg)],
    rule: "mkdir_stamp",
    inputs: [],
    vars: { dir: n.rel(cfg.codegenDir) },
  });

  // Stamps dir — holds pkg_install stamp files.
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
 * rust build, link) add the appropriate group to their implicit inputs.
 */
export interface CodegenOutputs {
  /** All codegen outputs — use for phony target `codegen`. */
  all: string[];

  /** Outputs the cargo step depends on (generated .rs that gets `include!`d). */
  rustInputs: string[];

  /** Outputs the cargo step needs to exist but doesn't embed (debug bake runtime). */
  rustOrderOnly: string[];

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
   * doesn't need bake.*.js, runtime.out.js, or any other rust-side embedded
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

  /**
   * Stamp output from the package install at repo root.
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

  // ─── Root install (provides esbuild + lezer-cpp for cppbind) ───
  const rootInstall = emitPackageInstall(n, cfg, cfg.cwd);

  const o: CodegenOutputs = {
    all: [],
    rustInputs: [],
    rustOrderOnly: [],
    cppSources: [],
    cppHeaders: [],
    cppAll: [],
    bindgenV2Cpp: [],
    rootInstall,
  };

  const ctx: Ctx = { n, cfg, sources, o, dirStamp };

  // Configure-time write (not a ninja edge — it's a constant manifest like
  // depVersionsHeader). Pushed into rustInputs so the cargo edge implicit-deps
  // on it; bun_core/build.rs emits the matching `rerun-if-changed`.
  const buildOptionsRs = generateBuildOptionsRs(cfg);
  o.all.push(buildOptionsRs);
  o.rustInputs.push(buildOptionsRs);

  // Same shape: the JSON byte-classification tables, consumed by both the
  // Highway kernel (.h) and the Rust scalar indexer (.rs).
  const jsonByteClass = generateJsonByteClass(cfg);
  o.all.push(jsonByteClass.h, jsonByteClass.rs);
  o.rustInputs.push(jsonByteClass.rs);
  o.cppHeaders.push(jsonByteClass.h);

  emitBunError(ctx);
  emitStringMaps(ctx);
  emitFallbackDecoder(ctx);
  emitRuntimeJs(ctx);
  emitNodeFallbacks(ctx);
  emitErrorCode(ctx);
  emitGeneratedClasses(ctx);
  emitHostExports(ctx);
  emitCppBind(ctx);
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
 * Emit a package-install step for a directory. Returns the stamp file path —
 * use it as an implicit input on anything that needs node_modules/.
 *
 * The stamp is the explicit output; each node_modules/<dep>/package.json is
 * an implicit output (so deleting node_modules/ correctly retriggers install,
 * and restat prunes downstream when install was a no-op).
 */
function emitPackageInstall(n: Ninja, cfg: Config, pkgDir: string): string {
  const depPackageJsons = readPackageDeps(pkgDir);
  assert(depPackageJsons.length > 0, `package.json has no dependencies: ${pkgDir}/package.json`);

  const pkgJson = resolve(pkgDir, "package.json");
  const lockfile = resolve(pkgDir, cfg.packageManager.lockfile);
  // Lockfile is optional (some packages might not have one for the active
  // manager), but if it exists it MUST be an input — version bumps reinstall.
  const inputs = [pkgJson];
  try {
    readFileSync(lockfile); // exists check
    inputs.push(lockfile);
  } catch {
    // no lockfile, that's fine
  }

  // Stamp lives in the build dir, not the package dir — keeps the source
  // tree clean and makes `rm -rf build/` fully reset install state.
  const stampName = pkgDir.replace(/[^A-Za-z0-9]+/g, "_");
  const stamp = resolve(cfg.buildDir, "stamps", `install_${stampName}.stamp`);

  n.build({
    outputs: [stamp],
    implicitOutputs: depPackageJsons,
    rule: "pkg_install",
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
  const installStamp = emitPackageInstall(n, cfg, sourceDir);

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
  o.rustInputs.push(...outputs);
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
  o.rustInputs.push(out);
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
  o.rustInputs.push(out);
}

function emitNodeFallbacks({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const sourceDir = resolve(cfg.cwd, "src", "node-fallbacks");
  const installStamp = emitPackageInstall(n, cfg, sourceDir);

  const outDir = resolve(cfg.codegenDir, "node-fallbacks");
  // Two outputs per source: the bundled `.js` (read at runtime by debug
  // builds) and its zstd-compressed `.js.zst` twin (embedded by release
  // builds — see src/resolver/node_fallbacks.rs).
  const jsOutputs = sources.nodeFallbacks.map(s => resolve(outDir, basename(s)));
  const outputs = [...jsOutputs, ...jsOutputs.map(o => `${o}.zst`)];

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
      args: shJoin(cfg, [script, outDir, ...sources.nodeFallbacks]),
    },
  });

  o.all.push(...outputs);
  o.rustInputs.push(...outputs);

  // ─── react-refresh (separate bundle, uses node-fallbacks' node_modules) ───
  const rrSrc = resolve(sourceDir, "node_modules", "react-refresh", "cjs", "react-refresh-runtime.development.js");
  const rrOut = resolve(outDir, "react-refresh.js");
  n.build({
    outputs: [rrOut],
    rule: "esbuild",
    inputs: [resolve(sourceDir, "package.json")],
    implicitInputs: [installStamp, o.rootInstall],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: sourceDir,
      desc: "node-fallbacks/react-refresh.js",
      args: shJoin(cfg, [
        rrSrc,
        `--outfile=${rrOut}`,
        "--bundle",
        "--platform=browser",
        "--format=cjs",
        "--minify",
        `--define:process.env.NODE_ENV="development"`,
      ]),
    },
  });

  o.all.push(rrOut);
  o.rustInputs.push(rrOut);
}

/**
 * `*.string-map.ts` → length-bucketed lookup fns (`generate-string-map.ts`).
 * Output lands **in-tree** as `<dir>/<stem>.generated.rs` (checked in) so
 * plain `cargo check` / rust-analyzer work without `BUN_CODEGEN_DIR` or a
 * per-crate `build.rs`. The `.string-map.ts` is the source of truth; the
 * `.generated.rs` is a deterministic artifact whose drift is caught by
 * `bun run codegen:verify` in CI (format job). `restat = 1` on the codegen
 * rule + `writeIfNotChanged` in the script keep this a no-op when unchanged.
 */
function emitStringMaps({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "generate-string-map.ts");
  for (const src of sources.stringMaps) {
    // `src/js_parser/defines_table.string-map.ts` → `src/js_parser/defines_table.generated.rs`
    const stem = basename(src).replace(/\.string-map\.ts$/, "");
    const out = resolve(dirname(src), `${stem}.generated.rs`);
    n.build({
      outputs: [out],
      rule: "codegen",
      inputs: [script, src],
      orderOnlyInputs: [dirStamp],
      vars: {
        cwd: cfg.cwd,
        desc: `string-map ${stem}`,
        args: shJoin(cfg, [script, src, out]),
      },
    });
    o.all.push(out);
    o.rustInputs.push(out);
  }
}

function emitErrorCode({ n, cfg, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "generate-node-errors.ts");
  const inputs = [
    script,
    resolve(cfg.cwd, "src", "jsc", "bindings", "ErrorCode.ts"),
    // ErrorCode.cpp/.h are listed in CMake but the script doesn't read them;
    // they're there so changes to the handwritten side (e.g. new error
    // category added to the C++ enum) invalidate this step. We include them
    // for the same reason.
    resolve(cfg.cwd, "src", "jsc", "bindings", "ErrorCode.cpp"),
    resolve(cfg.cwd, "src", "jsc", "bindings", "ErrorCode.h"),
  ];

  const cppOutputs = [resolve(cfg.codegenDir, "ErrorCode+List.h"), resolve(cfg.codegenDir, "ErrorCode+Data.h")];
  const rustOutput = resolve(cfg.codegenDir, "ErrorCode.generated.rs");
  const outputs = [...cppOutputs, rustOutput];

  n.build({
    outputs,
    rule: "codegen",
    inputs,
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "ErrorCode+*.h",
      args: shJoin(cfg, [script, cfg.codegenDir]),
    },
  });

  o.all.push(...outputs);
  o.rustInputs.push(...outputs);
  o.cppHeaders.push(...cppOutputs);
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
    resolve(cfg.codegenDir, "ZigGeneratedClasses.lut.txt"),
    // Rust sibling: include!()'d by src/runtime/generated_classes.rs. Must be
    // a declared output so the cargo edge (which lists this in rustInputs)
    // re-invokes when generate-classes.ts changes — cargo doesn't track
    // include!() deps and the includer shim's mtime never moves.
    resolve(cfg.codegenDir, "generated_classes.rs"),
  ];

  n.build({
    outputs,
    rule: "codegen",
    inputs: [script, ...sources.zigGeneratedClasses],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "ZigGeneratedClasses.{cpp,h,rs}",
      args: shJoin(cfg, [script, ...sources.zigGeneratedClasses, cfg.codegenDir]),
    },
  });

  o.all.push(...outputs);
  o.rustInputs.push(...outputs);
  o.cppSources.push(outputs[1]!); // .cpp
  o.cppHeaders.push(outputs[0]!, outputs[2]!, outputs[3]!, outputs[4]!, outputs[5]!); // .h files
  // .lut.txt is consumed by emitObjectLuts below
}

function emitHostExports({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "generate-host-exports.ts");
  const output = resolve(cfg.codegenDir, "generated_host_exports.rs");

  // Inputs: every .rs under src/runtime + src/jsc (the scrape scope). The
  // `sources.rust` glob already covers these plus Cargo manifests; filter to
  // the two crates so unrelated edits (e.g. src/bundler) don't re-run the
  // scrape. restat=1 + writeIfNotChanged means a no-marker-change edit
  // produces identical output and the cargo step is pruned.
  const rsInputs = sources.rust.filter(
    p =>
      p.endsWith(".rs") &&
      (p.includes(`${cfg.cwd}/src/runtime/`.replace(/\//g, "/")) ||
        p.includes(`${cfg.cwd}/src/jsc/`.replace(/\//g, "/"))) &&
      !p.endsWith("generated_host_exports.rs"),
  );

  n.build({
    outputs: [output],
    rule: "codegen",
    inputs: [script],
    implicitInputs: rsInputs,
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "generated_host_exports.rs",
      args: shJoin(cfg, [script, cfg.codegenDir]),
    },
  });

  o.all.push(output);
  // bun_runtime/build.rs panics if this file is absent, so the rust_build edge
  // must wait on it — `rustInputs` is the implicit-dep list the
  // cargo edge consumes.
  o.rustInputs.push(output);
}

function emitCppBind({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "cppbind.ts");

  const outputRs = resolve(cfg.codegenDir, "cpp.rs");

  // Write the .cpp file list for cppbind to scan. Build system owns the
  // glob (glob-sources.ts); we hand the result to cppbind
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
    outputs: [outputRs],
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
      desc: "cpp.rs (cppbind)",
      // cppbind.ts takes: <srcdir> <codegendir> <cxx-sources>. No `run` —
      // direct script invocation (`${BUN_EXECUTABLE} ${script} ...`).
      args: shJoin(cfg, [script, resolve(cfg.cwd, "src"), cfg.codegenDir, cxxSourcesFile]),
    },
  });

  o.all.push(outputRs);
  // bun_jsc `include!`s cpp.rs — the cargo edge must order after this.
  o.rustInputs.push(outputRs);
}

function emitJsModules({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "bundle-modules.ts");

  // InternalModuleRegistry.cpp is read by the script (for a sanity check).
  const extraInput = resolve(cfg.cwd, "src", "jsc", "bindings", "InternalModuleRegistry.cpp");
  // replacements.ts bakes ErrorCode.ts indices into every bundled module
  // ($makeErrorWithCode(N, ...)); without this dep an ErrorCode.ts edit leaves
  // stale error numbers in the JS bundles while the C++ enum regenerates.
  const errorCodeInput = resolve(cfg.cwd, "src", "jsc", "bindings", "ErrorCode.ts");

  const outputs = [
    resolve(cfg.codegenDir, "WebCoreJSBuiltins.cpp"),
    resolve(cfg.codegenDir, "WebCoreJSBuiltins.h"),
    resolve(cfg.codegenDir, "InternalModuleRegistryConstants.h"),
    resolve(cfg.codegenDir, "InternalModuleRegistry+createInternalModuleById.h"),
    resolve(cfg.codegenDir, "InternalModuleRegistry+enum.h"),
    resolve(cfg.codegenDir, "InternalModuleRegistry+numberOfModules.h"),
    resolve(cfg.codegenDir, "NativeModuleImpl.h"),
    resolve(cfg.codegenDir, "SyntheticModuleType.h"),
    resolve(cfg.codegenDir, "GeneratedJS2Native.h"),
    // Rust sibling: include!()'d by src/runtime/generated_js2native.rs. Must be
    // a declared output so the cargo edge re-invokes when bundle-modules.ts /
    // generate-js2native.ts changes — the includer shim's mtime never moves.
    resolve(cfg.codegenDir, "generated_js2native.rs"),
    // Specifier → module-ID tag table: include!()'d by the
    // `resolved_source_tag` module in src/jsc/lib.rs. Declared for the same
    // reason as generated_js2native.rs.
    resolve(cfg.codegenDir, "generated_resolved_source_tag.rs"),
  ];

  n.build({
    outputs,
    rule: "codegen",
    inputs: [script, ...sources.js, ...sources.jsCodegen, extraInput, errorCodeInput],
    implicitInputs: [o.rootInstall],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "JS modules (bundle-modules)",
      // Note: arg is BUILD_PATH (buildDir), not CODEGEN_PATH. The script
      // derives CODEGEN_DIR = join(BUILD_PATH, "codegen") internally.
      args: shJoin(cfg, [script, debugFlag(cfg), cfg.buildDir]),
    },
  });

  o.all.push(...outputs);
  o.rustInputs.push(...outputs);
  o.cppSources.push(outputs[0]!); // WebCoreJSBuiltins.cpp
  o.cppHeaders.push(...outputs.filter(p => p.endsWith(".h")));
}

function emitBakeCodegen({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "bake-codegen.ts");

  // InternalModuleRegistry.cpp is listed as a dep in CMake for this step too.
  // The script doesn't read it; CMake copy-paste. We skip it.

  // CMake only declares bake.client.js and bake.server.js as outputs. The
  // script also emits bake.error.js (the runtime embeds it). We declare
  // all three.
  //
  // Debug uses order-only deps on these .js files (loaded at runtime,
  // no need to relink on change). Release uses implicit (embedded into
  // the binary, must relink).
  const outputs = [
    resolve(cfg.codegenDir, "bake.client.js"),
    resolve(cfg.codegenDir, "bake.server.js"),
    resolve(cfg.codegenDir, "bake.error.js"),
  ];

  n.build({
    outputs,
    rule: "codegen",
    inputs: [script, ...sources.bakeRuntime],
    implicitInputs: [o.rootInstall],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "bake.{client,server,error}.js",
      args: shJoin(cfg, [script, debugFlag(cfg), `--codegen-root=${cfg.codegenDir}`]),
    },
  });

  o.all.push(...outputs);
  // Debug: read at RUNTIME (not embedded) → the build only needs existence.
  // Release: embedded into the binary → content changes must trigger a relink.
  if (cfg.debug) {
    o.rustOrderOnly.push(...outputs);
  } else {
    o.rustInputs.push(...outputs);
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
  const nodeLoader = pathToFileURL(resolve(cfg.cwd, "src", "codegen", "node-loader.ts")).href;
  const [rt, ...rtArgs] = cfg.jsRuntimeArgv;
  const listResult = spawnSync(
    rt,
    [
      ...rtArgs,
      "--import",
      nodeLoader,
      script,
      "--command=list-outputs",
      `--sources=${sourcesArg}`,
      `--codegen-path=${cfg.codegenDir}`,
    ],
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
  const other = allOutputs.filter(p => !p.endsWith(".cpp"));
  assert(other.length === 0, `bindgenv2 emitted unexpected output type: ${other.join(", ")}`);

  n.build({
    outputs: allOutputs,
    rule: "codegen",
    inputs: [script, ...sources.bindgenV2, ...sources.bindgenV2Internal],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "bindgenv2",
      args: shJoin(cfg, [script, "--command=generate", `--codegen-path=${cfg.codegenDir}`, `--sources=${sourcesArg}`]),
    },
  });

  o.all.push(...allOutputs);
  o.bindgenV2Cpp.push(...cppOutputs);
}

function emitBindgen({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "bindgen.ts");

  const cppOut = resolve(cfg.codegenDir, "GeneratedBindings.cpp");

  // bindgen.ts scans src/ for .bind.ts files itself — this list is only for
  // ninja dependency tracking. New .bind.ts files need a reconfigure to be
  // picked up (next glob gets them).
  n.build({
    outputs: [cppOut],
    rule: "codegen",
    inputs: [script, ...sources.bindgen],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: ".bind.ts → GeneratedBindings.cpp",
      args: shJoin(cfg, [script, debugFlag(cfg), `--codegen-root=${cfg.codegenDir}`]),
    },
  });

  o.all.push(cppOut);
  o.cppSources.push(cppOut);
}

function emitJsSink({ n, cfg, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "generate-jssink.ts");
  const hashTableScript = resolve(cfg.cwd, "src", "codegen", "create-hash-table.ts");
  const perlScript = resolve(cfg.cwd, "src", "codegen", "create_hash_table");

  // generate-jssink.ts writes JSSink.{cpp,h,lut.txt} + generated_jssink.rs (the
  // Rust `#[no_mangle]` thunks), then internally spawns create-hash-table.ts to
  // convert .lut.txt → .lut.h. So all of {cpp,h,lut.h,rs} are outputs of this
  // one step (.lut.txt is really an intermediate — we don't expose it).
  const jssinkRs = resolve(cfg.codegenDir, "generated_jssink.rs");
  const outputs = [
    resolve(cfg.codegenDir, "JSSink.cpp"),
    resolve(cfg.codegenDir, "JSSink.h"),
    resolve(cfg.codegenDir, "JSSink.lut.h"),
    jssinkRs,
  ];

  n.build({
    outputs,
    rule: "codegen",
    inputs: [script, hashTableScript, perlScript],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "JSSink.{cpp,h,lut.h,rs}",
      args: shJoin(cfg, [script, cfg.codegenDir]),
    },
  });

  o.all.push(...outputs);
  o.cppSources.push(outputs[0]!); // .cpp
  o.cppHeaders.push(outputs[1]!, outputs[2]!); // .h + .lut.h
  // bun_runtime/build.rs panics if generated_jssink.rs is absent, so the
  // rust_build edge must order after this codegen step — `rustInputs` is the
  // implicit-dep list the cargo edge consumes (same as generated_host_exports).
  // Without this, `mode: "rust-only"` (CI's build-rust job, which compiles no
  // C++ so nothing else pulls JSSink.cpp/.h) never runs this edge and cargo
  // hits the missing file.
  o.rustInputs.push(jssinkRs);
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
    [resolve(cfg.cwd, "src/jsc/bindings/BunObject.cpp"), resolve(cfg.codegenDir, "BunObject.lut.h")],
    [resolve(cfg.cwd, "src/jsc/bindings/ZigGlobalObject.lut.txt"), resolve(cfg.codegenDir, "ZigGlobalObject.lut.h")],
    [resolve(cfg.cwd, "src/jsc/bindings/JSBuffer.cpp"), resolve(cfg.codegenDir, "JSBuffer.lut.h")],
    [resolve(cfg.cwd, "src/jsc/bindings/BunProcess.cpp"), resolve(cfg.codegenDir, "BunProcess.lut.h")],
    [
      resolve(cfg.cwd, "src/jsc/bindings/ProcessBindingBuffer.cpp"),
      resolve(cfg.codegenDir, "ProcessBindingBuffer.lut.h"),
    ],
    [
      resolve(cfg.cwd, "src/jsc/bindings/ProcessBindingConstants.cpp"),
      resolve(cfg.codegenDir, "ProcessBindingConstants.lut.h"),
    ],
    [resolve(cfg.cwd, "src/jsc/bindings/ProcessBindingFs.cpp"), resolve(cfg.codegenDir, "ProcessBindingFs.lut.h")],
    [
      resolve(cfg.cwd, "src/jsc/bindings/ProcessBindingNatives.cpp"),
      resolve(cfg.codegenDir, "ProcessBindingNatives.lut.h"),
    ],
    [
      resolve(cfg.cwd, "src/jsc/bindings/ProcessBindingHTTPParser.cpp"),
      resolve(cfg.codegenDir, "ProcessBindingHTTPParser.lut.h"),
    ],
    [resolve(cfg.cwd, "src/jsc/modules/NodeModuleModule.cpp"), resolve(cfg.codegenDir, "NodeModuleModule.lut.h")],
    [resolve(cfg.codegenDir, "ZigGeneratedClasses.lut.txt"), resolve(cfg.codegenDir, "ZigGeneratedClasses.lut.h")],
    [resolve(cfg.cwd, "src/jsc/bindings/webcore/JSEvent.cpp"), resolve(cfg.codegenDir, "JSEvent.lut.h")],
  ];

  // create-hash-table.ts reads TARGET_PLATFORM env (set in registerCodegenRules)
  // with process.platform fallback.
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
        args: shJoin(cfg, [script, src, out]),
      },
    });
    o.all.push(out);
    o.cppHeaders.push(out);
  }
}
