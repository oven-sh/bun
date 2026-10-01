/**
 * Configure: resolve config → emit build.ninja.
 *
 * Separated from build.ts so configure can be called standalone (just
 * regenerate ninja without running the build) and so CI orchestration
 * can configure once then run specific targets.
 */

import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdirSync, utimesSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isBuildkite } from "../buildkite.ts";
import { globAllSources } from "../glob-sources.ts";
import { type BunOutput, bunExeName, emitBun, shouldStrip, validateBunConfig } from "./bun.ts";
import { generateCargoConfig } from "./cargo-config.ts";
import { emitCodegen, registerCodegenRules } from "./codegen.ts";
import { registerDirStamps } from "./compile.ts";
import {
  type CodegenConfig,
  type Config,
  type JsToolchain,
  type Mode,
  type OS,
  type PackageManager,
  type PartialConfig,
  type Toolchain,
  detectHost,
  findRepoRoot,
  resolveCodegenConfig,
  resolveConfig,
} from "./config.ts";
import { BuildError } from "./error.ts";
import { orderFilePath, usesOrderFile } from "./flags.ts";
import { mkdirAll, writeIfChanged } from "./fs.ts";
import { ensureMacosSdk } from "./macos-sdk.ts";
import { ensureNinja } from "./ninja-release.ts";
import { Ninja } from "./ninja.ts";
import { getProfile } from "./profiles.ts";
import { registerAllRules } from "./rules.ts";
import { rustPlanFiles } from "./rust.ts";
import { quote } from "./shell.ts";
import {
  checkImageTools,
  findBun,
  findCargo,
  findMsvcLinker,
  findNpm,
  findSystemTool,
  resolveLlvmToolchain,
  writeToolIdentities,
} from "./tools.ts";
import { ensureWindowsSysroot } from "./winsysroot.ts";
import { checkWorkarounds } from "./workarounds.ts";

/** The JavaScript tools: what the code generators run with, and all that `mode: "codegen"` looks for. */
export function resolveJsToolchain(packageManager: PackageManager = "bun"): JsToolchain {
  const host = detectHost();
  // esbuild path is relative to REPO ROOT, not process.cwd() — when
  // ninja's generator rule invokes reconfigure, cwd is the build dir.
  const repoRoot = findRepoRoot();

  // esbuild — comes from the root install. Path is deterministic.
  // If not present, the first codegen build will fail with a clear error
  // (and the build itself runs the install first via the root install
  // stamp, so this path will exist by the time esbuild rules fire).
  // On Windows, bun writes `.bin/esbuild.exe` and npm writes `.bin/esbuild.cmd`.
  const windowsBin = packageManager === "npm" ? "esbuild.cmd" : "esbuild.exe";
  const esbuild = resolve(repoRoot, "node_modules", ".bin", host.os === "windows" ? windowsBin : "esbuild");

  const bun = findBun(host.os);
  const npm = packageManager === "npm" ? findNpm() : undefined;

  // jsRuntime: shell-ready prefix for running .ts subprocesses. Propagate
  // whatever's running us — if node, the strip-types flag comes along; if
  // bun, it's just the path. process.versions.bun distinguishes (undefined
  // in node). Pre-quoted so rule commands can splice it directly.
  //
  // The codegen scripts are ES modules under the root package.json, which
  // has no "type" field. Node detects the module syntax and prints
  // MODULE_TYPELESS_PACKAGE_JSON once per process, so the flag hides it.
  //
  // A codegen script that a module can also import runs its command line
  // only when import.meta.main is true. Node 24.2 added import.meta.main.
  // Before that it is undefined, and the script would write nothing. CI
  // installs Node 26 (scripts/build/ci-images/spec.ts), so the minimum is 25.
  if (process.versions.bun === undefined) {
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 25) {
      throw new BuildError(`Node ${process.versions.node} cannot run the codegen scripts`, {
        hint: "Install Node 25 or later, or run the build with bun.",
      });
    }
  }
  const q = (p: string) => quote(p, host.os === "windows");
  const jsRuntime =
    process.versions.bun !== undefined
      ? q(process.execPath)
      : `${q(process.execPath)} --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON`;

  return { bun, npm, jsRuntime, esbuild };
}

/**
 * Full toolchain discovery. Returns absolute paths to all required tools.
 *
 * `targetOs` (defaults to the host) decides which tool family is resolved —
 * a windows target needs the MSVC-style drivers (clang-cl, llvm-lib,
 * lld-link, llvm-rc) even from a linux/macOS host.
 *
 * Throws BuildError with a hint if a required tool is missing. Optional
 * tools (ccache, cargo if no rust deps needed) become `undefined`.
 */
export function resolveToolchain(targetOs?: OS, packageManager: PackageManager = "bun"): Toolchain {
  const host = detectHost();
  const llvm = resolveLlvmToolchain(host.os, host.arch, targetOs ?? host.os);

  // cmake — required for nested dep builds.
  const cmake = findSystemTool("cmake", { required: true, hint: "Install cmake (>= 3.24)" });
  if (cmake === undefined) throw new BuildError("unreachable: findSystemTool required=true returned undefined");

  // cargo — required for lolhtml. Not found → build will fail at that dep
  // with a clear "install rust" hint. We don't hard-fail here because
  // someone might be testing a subset that doesn't need lolhtml.
  const rust = findCargo(host.os);

  // Windows: MSVC link.exe path (to prevent Git Bash's /usr/bin/link
  // shadowing). Only needed when cargo builds with the msvc target.
  const msvcLinker = host.os === "windows" ? findMsvcLinker(host.arch) : undefined;

  return {
    ...llvm,
    ...resolveJsToolchain(packageManager),
    cmake,
    cargo: rust?.cargo,
    cargoHome: rust?.cargoHome,
    rustupHome: rust?.rustupHome,
    msvcLinker,
  };
}

export interface ConfigureResult {
  cfg: Config;
  output: BunOutput;
  /** Build.ninja absolute path. */
  ninjaFile: string;
  /** The ninja to run the build with (ninja-release.ts): a path, or `ninja` for the one on PATH. */
  ninja: string;
  /** Env vars the caller should set before spawning ninja. */
  env: Record<string, string>;
  /** Wall-clock ms for the configure pass. */
  elapsed: number;
  /** True if build.ninja actually changed (vs an idempotent re-run). */
  changed: boolean;
  /** Final executable name (e.g. "bun-debug"). For status messages. */
  exe: string;
}

/**
 * Files that, when changed, should trigger a reconfigure. Globbed at
 * configure time — if you add a new build script, it'll be picked up
 * on the next reconfigure (since adding a .ts usually means editing
 * an existing one to import it).
 *
 * Excludes scripts that only run as ninja subprocesses (ci.ts, stream.ts,
 * npm-ci.ts) — changes to those don't affect the build graph. fetch-cli.ts
 * and download.ts count: configure computes fetch URLs and checks source
 * staleness through them.
 */
function configureInputs(cwd: string): string[] {
  const buildDir = resolve(cwd, "scripts", "build");
  const excluded = new Set(["ci.ts", "stream.ts", "npm-ci.ts"]);

  const scripts = globSync("*.ts", { cwd: buildDir })
    .filter(f => !excluded.has(f))
    .map(f => resolve(buildDir, f));
  const deps = globSync("deps/*.ts", { cwd: buildDir }).map(f => resolve(buildDir, f));
  // rust/: units.ts/emit.ts/plan.ts shape the per-crate edges and manifests at configure time (run.ts is build-time
  // only, but one glob keeps the rule simple).
  const rust = globSync("rust/*.ts", { cwd: buildDir }).map(f => resolve(buildDir, f));

  // Versions the build uses (LLVM, Node.js, the sysroots) are written here.
  const pins = resolve(buildDir, "ci-images", "spec.ts");

  return [
    ...scripts,
    ...deps,
    ...rust,
    pins,
    resolve(cwd, "scripts", "glob-sources.ts"),
    resolve(cwd, "package.json"),
    // The ELF link's export list is written from these (bun.ts linkImplicitInputs).
    resolve(cwd, "src", "linker.lds"),
    resolve(cwd, "src", "linker-freebsd.lds"),
  ].sort();
}

/**
 * What the user asked for, *before* profile expansion. This is what gets
 * persisted to configure.json and replayed by ninja's generator rule.
 *
 * We persist the profile NAME (not its expanded values) so that editing
 * profiles.ts propagates to existing build dirs on the next regen. The old
 * scheme persisted the post-merge PartialConfig, which froze whatever the
 * profile said at first-configure time — a build dir would keep replaying
 * a value forever even after the profile changed it.
 */
export interface ConfigureInput {
  /** Profile name to resolve via getProfile(). Omitted = no profile base. */
  profile?: string;
  /** Explicit CLI overrides layered on top of the profile. */
  overrides?: PartialConfig;
}

/**
 * Emit the generator rule — makes build.ninja self-rebuilding. When you
 * run `ninja` directly and a build script has changed, ninja runs
 * reconfigure first, then restarts with the fresh graph.
 *
 * The *unresolved* ConfigureInput (profile name + CLI overrides) is
 * persisted to configure.json; the regen command reads it back via
 * --config-file and re-expands the profile against the current
 * profiles.ts. Edits to a profile therefore take effect on the next
 * `ninja` in an existing build dir without `rm -rf`.
 */
function emitGeneratorRule(n: Ninja, cfg: Config | CodegenConfig, input: ConfigureInput): void {
  const configFile = resolve(cfg.buildDir, "configure.json");
  const buildScript = resolve(cfg.cwd, "scripts", "build.ts");

  // Persist the unresolved input. writeIfChanged — same input → no mtime
  // bump → no unnecessary regen on identical reconfigures.
  // This runs before n.write() (which mkdir's), so ensure dir exists.
  mkdirSync(cfg.buildDir, { recursive: true });
  writeIfChanged(configFile, JSON.stringify(input, null, 2) + "\n");

  const hostWin = cfg.host.os === "windows";
  n.rule("regen", {
    command: `${cfg.jsRuntime} ${quote(buildScript, hostWin)} --config-file=$in`,
    description: "reconfigure",
    // generator = 1: exempt from `ninja -t clean`, triggers manifest restart
    // when the output (build.ninja) is rebuilt.
    generator: true,
    // restat: configure uses writeIfChanged on build.ninja. If nothing
    // actually changed (unlikely when inputs changed, but possible for
    // cosmetic edits), no restart happens.
    restat: true,
    pool: "console",
  });

  n.build({
    outputs: [resolve(cfg.buildDir, "build.ninja")],
    rule: "regen",
    inputs: [configFile],
    // The Rust plans: the per-crate edges are generated from them (rust.ts), so a changed plan — new lockfile,
    // manifest, toolchain — must reconfigure. They are build outputs; when one is dirty ninja builds it first,
    // reruns this edge, and restarts with the new manifest.
    implicitInputs: [...configureInputs(cfg.cwd), ...(buildsRust(cfg) ? rustPlanFiles(cfg) : [])],
  });
}

/** Whether this graph compiles bun's Rust crates (and therefore has the plan edges emitRust registers): every build but `codegen`. */
function buildsRust(cfg: Config | CodegenConfig): cfg is Config {
  return cfg.mode !== "codegen";
}

/**
 * ccache environment to set for compile commands. Points ccache into
 * cfg.cacheDir (machine-shared locally, per-build in CI — see resolveConfig).
 */
function ccacheEnv(cfg: Config): Record<string, string> {
  if (cfg.ccache === undefined) return {};
  const env: Record<string, string> = {
    CCACHE_DIR: resolve(cfg.cacheDir, "ccache"),
    // basedir + nohashdir: relativize paths in cache keys so the same
    // source at different checkout locations shares cache entries.
    CCACHE_BASEDIR: cfg.cwd,
    CCACHE_NOHASHDIR: "1",
    // Copy-on-write for cache entries — near-free on btrfs/APFS/ReFS.
    CCACHE_FILECLONE: "1",
    CCACHE_STATSLOG: resolve(cfg.buildDir, "ccache.log"),
  };
  if (!cfg.ci) {
    env.CCACHE_MAXSIZE = "100G";
    // Sloppiness: ignore differences that don't affect output. pch_defines:
    // PCH can change without the includer's -D list changing. time_macros:
    // __TIME__ differs every build. random_seed: -frandom-seed=0 is in our
    // flags but ccache doesn't know that. clang_index_store: clangd state.
    env.CCACHE_SLOPPINESS = "pch_defines,time_macros,locale,random_seed,clang_index_store,gcno_cwd";
  }
  return env;
}

/**
 * Configure: resolve config → emit build.ninja. Returns the resolved config
 * and emitted build info.
 *
 * `input` is the profile name + explicit CLI overrides. The profile is
 * expanded here (not by the caller) so the generator rule can persist the
 * unresolved input and re-expand it on regen — see emitGeneratorRule. If
 * no buildDir is set, one is computed from the build type (build/debug,
 * build/release, etc).
 */
/** Expand profile → PartialConfig. Overrides win. */
function partialOf(input: ConfigureInput): PartialConfig {
  return {
    ...(input.profile !== undefined ? getProfile(input.profile) : {}),
    ...(input.overrides ?? {}),
  };
}

/** The mode an input asks for. `codegen` is configured by configureCodegen(), `full` by configure(). */
export function modeOf(input: ConfigureInput): Mode {
  const mode = partialOf(input).mode ?? "full";
  if (mode !== "full" && mode !== "codegen") {
    throw new BuildError(`Unknown mode: "${mode}"`, { hint: "Modes: full, codegen" });
  }
  return mode;
}

/** The Config an input stands for. Writes and fetches nothing: for configure, and for what only needs to find a build directory. */
export function configOf(input: ConfigureInput): { cfg: Config; toolchain: Toolchain } {
  const partial = partialOf(input);
  const toolchain = resolveToolchain(partial.os, partial.packageManager);
  return { cfg: resolveConfig(partial, toolchain), toolchain };
}

/** configOf() for `mode: "codegen"`: looks for the JavaScript tools only. */
export function codegenConfigOf(input: ConfigureInput): CodegenConfig {
  const partial = partialOf(input);
  return resolveCodegenConfig(partial, resolveJsToolchain(partial.packageManager));
}

/** Write build.ninja (only if changed) and tell ninja's log that it is current. */
async function writeManifest(
  n: Ninja,
  cfg: Pick<Config, "buildDir">,
  ninja: string | undefined,
  mark: (label: string) => void,
): Promise<{ changed: boolean; ninjaPath: string }> {
  const changed = await n.write();
  const ninjaPath = resolve(cfg.buildDir, "build.ninja");
  mark("n.write");

  // build.ninja is also the output of the `regen` edge, whose inputs are the
  // build scripts and configure.json. ninja compares those against the mtime
  // it *recorded* for build.ninja when it last ran that edge itself, so after
  // a script edit a manifest brought up to date here (outside ninja) still
  // looks stale and ninja would run configure a second time on startup.
  // Having just configured, the manifest is current as of now: stamp it and
  // let `-t restat` record that. (Not when ninja is the one running us — it
  // records its own edge — and nothing to record into in a fresh dir.)
  if (ninja !== undefined) {
    const now = new Date();
    utimesSync(ninjaPath, now, now);
    if (existsSync(resolve(cfg.buildDir, ".ninja_log"))) {
      spawnSync(ninja, ["-C", cfg.buildDir, "-t", "restat", "build.ninja"], { stdio: "ignore" });
    }
  }
  mark("restat");
  return { changed, ninjaPath };
}

/** What configureCodegen() returns: configure()'s result without the native half. */
export interface CodegenConfigureResult<N extends string | undefined = string> {
  cfg: CodegenConfig;
  /** The ninja to run the build with (ninja-release.ts): a path, or `ninja` for the one on PATH. */
  ninja: N;
  /** Wall-clock ms for the configure pass. */
  elapsed: number;
}

/**
 * configure() for `mode: "codegen"`: a graph of the code generators alone, whose default target is `codegen`.
 * Looks for bun, the root install's esbuild and perl, and for no compiler, linker, cmake or cargo; writes no
 * `.cargo/config.toml` and fetches no SDK or sysroot. It has a build directory of its own (`build/debug-codegen`);
 * the type declarations go to `cfg.typesDir`, which every build directory shares.
 */
export function configureCodegen(input: ConfigureInput): Promise<CodegenConfigureResult> {
  return generateCodegen(input, ensureNinja);
}

/** reconfigure() for `mode: "codegen"`: the `regen` replay, which resolves no ninja. */
export async function reconfigureCodegen(input: ConfigureInput): Promise<void> {
  await generateCodegen(input, async () => undefined);
}

async function generateCodegen<N extends string | undefined>(
  input: ConfigureInput,
  resolveNinja: (cfg: CodegenConfig) => Promise<N>,
): Promise<CodegenConfigureResult<N>> {
  const start = performance.now();
  const trace = process.env.BUN_BUILD_TRACE === "1";
  const mark = (label: string) => {
    if (trace) process.stderr.write(`  ${label}: ${Math.round(performance.now() - start)}ms\n`);
  };

  const cfg = codegenConfigOf(input);
  mark("resolveCodegenConfig");

  const ninja = await resolveNinja(cfg);
  mark("ensureNinja");

  requirePerl();

  const sources = globAllSources();
  mark("globAllSources");

  const n = new Ninja({ buildDir: cfg.buildDir });
  registerDirStamps(n, cfg);
  registerCodegenRules(n, cfg);
  mkdirSync(cfg.buildDir, { recursive: true });
  emitCodegen(n, cfg, sources);
  mark("emitCodegen");
  emitGeneratorRule(n, cfg, input);
  n.default(["codegen"]);

  await writeManifest(n, cfg, ninja, mark);
  return { cfg, ninja, elapsed: Math.round(performance.now() - start) };
}

/** LUT codegen (create-hash-table.ts) shells out to a perl script; without perl it fails cryptically. */
function requirePerl(): void {
  if (findSystemTool("perl") === undefined) {
    throw new BuildError("perl not found in PATH", {
      hint: "LUT codegen (create-hash-table.ts) needs perl. Install it: apt install perl / brew install perl",
    });
  }
}

/** build.ts configuring before it spawns ninja: resolves the ninja to spawn (ninja-release.ts). */
export function configure(input: ConfigureInput): Promise<ConfigureResult> {
  return generate(input, ensureNinja);
}

/**
 * ninja's own `regen` edge replaying configure.json (build.ts --config-file): rewrites build.ninja and what is
 * written beside it. It runs inside the ninja that was chosen and starts none, so it does not look for one: asking
 * whether the pinned ninja can run is a process spawned for an answer nobody reads, and on a machine that refuses
 * to run it, a second refusal in the middle of the build.
 */
export async function reconfigure(input: ConfigureInput): Promise<void> {
  await generate(input, async () => undefined);
}

async function generate<N extends string | undefined>(
  input: ConfigureInput,
  resolveNinja: (cfg: Config) => Promise<N>,
): Promise<Omit<ConfigureResult, "ninja"> & { ninja: N }> {
  const start = performance.now();
  const trace = process.env.BUN_BUILD_TRACE === "1";
  const mark = (label: string) => {
    if (trace) process.stderr.write(`  ${label}: ${Math.round(performance.now() - start)}ms\n`);
  };

  const { cfg, toolchain } = configOf(input);
  mark("resolveConfig");

  validateBunConfig(cfg);
  // Not cfg.ci or cfg.buildkite: those are what a ci-* profile asks for, and a
  // developer can build one (`bun run build:ci`) on a machine that is no image.
  if (isBuildkite) {
    checkImageTools(toolchain);
  }

  // Darwin cross-compile: the SDK must exist before ninja runs (every compile
  // edge passes -isysroot) and before checkWorkarounds() (the darwin-cross
  // workaround predicates inspect the SDK). resolveConfig picked the path;
  // this downloads the pinned SDK into the cache dir when nothing was found.
  // No-op otherwise.
  await ensureMacosSdk(cfg);
  mark("ensureMacosSdk");

  // The ninja itself, before anything here runs one (the restat below) so every
  // ninja that touches this build directory is the same one.
  const ninja = await resolveNinja(cfg);
  mark("ensureNinja");

  checkWorkarounds(cfg);

  // Windows cross-compile: make sure the MSVC CRT + Windows SDK splat is
  // usable BEFORE the graph is emitted — emitBun() enumerates its include
  // dirs (llvm-rc's /I flags) at configure time, so the sysroot must exist
  // by then, not just before ninja runs. CI fetches a missing sysroot into
  // the per-build cache; local builds require a provisioned one (the fetch
  // would be a surprise multi-GB download) and only get the case-alias
  // fixup + completeness check.
  if (cfg.windows && cfg.host.os !== "windows") {
    await ensureWindowsSysroot(cfg);
    mark("ensureWindowsSysroot");
  }

  // Generated `.cargo/config.toml` — written at configure time (not a ninja
  // rule), like `bun_dependency_versions.h`. Holds the per-target `linker = `
  // (the discovered clang++ from `tools.ts`) so a contributor running `cargo`
  // directly / rust-analyzer use the same toolchain the ninja build does.
  generateCargoConfig(cfg);
  writeToolIdentities(cfg);
  mark("generateCargoConfig");

  // Perl check: LUT codegen (create-hash-table.ts) shells out to the
  // perl script from JSC. If perl is missing, codegen fails cryptically.
  // Check here so the error is at configure time with a clear hint.
  requirePerl();
  mark("validate+perl");

  // Glob all source lists — one pass, consistent filesystem snapshot.
  const sources = globAllSources();
  mark("globAllSources");

  // Emit ninja.
  const n = new Ninja({ buildDir: cfg.buildDir });
  registerAllRules(n, cfg);
  // emitBun writes configure-time files into the build dir (dep `headers`,
  // the Windows .rc); it exists before anything is emitted.
  mkdirSync(cfg.buildDir, { recursive: true });
  const output = emitBun(n, cfg, sources);
  mark("emitBun");
  emitGeneratorRule(n, cfg, input);

  // Default targets: the `bun` phony (or stripped file); the smoke test
  // rides along as a validation of the link.
  // Release builds produce both bun-profile and stripped bun; `bun` is the
  // stripped one. Debug produces bun-debug; `bun` is a phony pointing at it.
  // dsym: darwin release only — pulled into defaults so ninja actually builds
  // it (no other node depends on it, and unlike cmake's POST_BUILD it doesn't
  // auto-trigger).
  const targets = [output.strippedExe !== undefined ? n.rel(output.strippedExe) : "bun"];
  if (output.dsym !== undefined) targets.push(n.rel(output.dsym));
  n.default(targets);

  const { changed, ninjaPath } = await writeManifest(n, cfg, ninja, mark);

  // Pre-create all object file parent directories (ninja would create them
  // edge by edge; having the tree up front serves tools that read
  // compile_commands.json before any edge ran). CMake pre-creates
  // CMakeFiles/<target>.dir/* at generate time, we do the same. Derived
  // from output.objects so there's no hidden state — the orchestrator
  // already knows every .o path.
  mkdirAll(output.objects.map(dirname));
  mark("mkdirAll");

  // Seed an empty symbol ordering file so the link flag always points at
  // something. Every linker treats an empty file as a no-op, which is the
  // unordered link; `bun run orderfile` overwrites it and ninja relinks
  // (linkDepends lists it). Never clobber an existing one — that would throw
  // away the file CI just inherited.
  if (usesOrderFile(cfg) && !existsSync(orderFilePath(cfg))) {
    writeIfChanged(orderFilePath(cfg), "# no order file yet — an empty file is a no-op for the linker\n");
  }
  mark("orderFile");

  const ninjaFile = ninjaPath;

  const elapsed = Math.round(performance.now() - start);
  const exe = bunExeName(cfg) + (shouldStrip(cfg) ? " → bun (stripped)" : "");

  return { cfg, output, ninjaFile, ninja, env: ccacheEnv(cfg), elapsed, changed, exe };
}
