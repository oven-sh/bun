/**
 * Configure: resolve config → emit build.ninja.
 *
 * Separated from build.ts so configure can be called standalone (just
 * regenerate ninja without running the build) and so CI orchestration
 * can configure once then run specific targets.
 */

import { globSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { globAllSources } from "../glob-sources.ts";
import { type BunOutput, bunExeName, emitBun, shouldStrip, validateBunConfig } from "./bun.ts";
import { generateCargoConfig } from "./cargo-config.ts";
import { type Config, type PartialConfig, type Toolchain, detectHost, findRepoRoot, resolveConfig } from "./config.ts";
import { BuildError } from "./error.ts";
import { mkdirAll, writeIfChanged } from "./fs.ts";
import { Ninja } from "./ninja.ts";
import { getProfile } from "./profiles.ts";
import { registerAllRules } from "./rules.ts";
import { quote } from "./shell.ts";
import { findBun, findCargo, findMsvcLinker, findSystemTool, resolveLlvmToolchain } from "./tools.ts";
import { checkWorkarounds } from "./workarounds.ts";

/**
 * Full toolchain discovery. Returns absolute paths to all required tools.
 *
 * Throws BuildError with a hint if a required tool is missing. Optional
 * tools (ccache, cargo if no rust deps needed) become `undefined`.
 */
export function resolveToolchain(): Toolchain {
  const host = detectHost();
  const llvm = resolveLlvmToolchain(host.os, host.arch);

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

  // esbuild path is relative to REPO ROOT, not process.cwd() — when
  // ninja's generator rule invokes reconfigure, cwd is the build dir.
  const repoRoot = findRepoRoot();

  // esbuild — comes from the root bun install. Path is deterministic.
  // If not present, the first codegen build will fail with a clear error
  // (and the build itself runs `bun install` first via the root install
  // stamp, so this path will exist by the time esbuild rules fire).
  const esbuild = resolve(repoRoot, "node_modules", ".bin", host.os === "windows" ? "esbuild.exe" : "esbuild");

  const bun = findBun(host.os);

  // jsRuntime: shell-ready prefix for running .ts subprocesses. Propagate
  // whatever's running us — if node, the strip-types flag comes along; if
  // bun, it's just the path. process.versions.bun distinguishes (undefined
  // in node). Pre-quoted so rule commands can splice it directly.
  const q = (p: string) => quote(p, host.os === "windows");
  const jsRuntime =
    process.versions.bun !== undefined ? q(process.execPath) : `${q(process.execPath)} --experimental-strip-types`;

  return {
    ...llvm,
    cmake,
    bun,
    jsRuntime,
    esbuild,
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
 * Excludes runtime-only files (fetch-cli.ts, download.ts, ci.ts) and
 * runtime-only scripts — changes to those don't affect the build graph.
 */
function configureInputs(cwd: string): string[] {
  const buildDir = resolve(cwd, "scripts", "build");
  const excluded = new Set(["fetch-cli.ts", "download.ts", "ci.ts", "stream.ts"]);

  const scripts = globSync("*.ts", { cwd: buildDir })
    .filter(f => !excluded.has(f))
    .map(f => resolve(buildDir, f));
  const deps = globSync("deps/*.ts", { cwd: buildDir }).map(f => resolve(buildDir, f));

  return [...scripts, ...deps, resolve(cwd, "scripts", "glob-sources.ts"), resolve(cwd, "package.json")].sort();
}

/**
 * What the user asked for, *before* profile expansion. This is what gets
 * persisted to configure.json and replayed by ninja's generator rule.
 *
 * We persist the profile NAME (not its expanded values) so that editing
 * profiles.ts propagates to existing build dirs on the next regen. The old
 * scheme persisted the post-merge PartialConfig, which froze whatever the
 * profile said at first-configure time — a build dir created from
 * `--profile=release --build-dir=build/btg` would keep replaying
 * `lto:false` forever even after a `btg` profile with `lto:true` was added.
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
function emitGeneratorRule(n: Ninja, cfg: Config, input: ConfigureInput): void {
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
    implicitInputs: configureInputs(cfg.cwd),
  });
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
export async function configure(input: ConfigureInput): Promise<ConfigureResult> {
  const start = performance.now();
  const trace = process.env.BUN_BUILD_TRACE === "1";
  const mark = (label: string) => {
    if (trace) process.stderr.write(`  ${label}: ${Math.round(performance.now() - start)}ms\n`);
  };

  // Expand profile → PartialConfig. Overrides win.
  const partial: PartialConfig = {
    ...(input.profile !== undefined ? getProfile(input.profile) : {}),
    ...(input.overrides ?? {}),
  };

  // Guard: build/btg is reserved for the LTO bench profile. Configuring it
  // with any other profile (e.g. `--profile=release --build-dir=build/btg`,
  // or a legacy configure.json migrated to {profile:"release",overrides:{…}})
  // persists lto:false and silently links the non-LTO WebKit prebuilt — the
  // bench suite then reports a phantom ~6-8% time / ~1 MB RSS "regression"
  // that is pure binary layout (.data.rel.ro vtables, outlined JSC slow-
  // paths), not src/ code. Fail loudly so the bench harness can't produce a
  // de-LTO'd comparison binary. See profiles.ts:btg.
  if (
    partial.buildDir !== undefined &&
    resolve(partial.buildDir) === resolve("build", "btg") &&
    input.profile !== "btg"
  ) {
    throw new BuildError(`build/btg must be configured with --profile=btg (lto:true)`, {
      hint:
        `Got profile=${input.profile ?? "<none>"}. Run \`bun run build:btg\` ` +
        `(or \`rm build/btg/configure.json\` first if regen is replaying a stale config).`,
    });
  }

  const toolchain = resolveToolchain();
  mark("resolveToolchain");
  const cfg = resolveConfig(partial, toolchain);

  validateBunConfig(cfg);
  checkWorkarounds(cfg);

  // Generated `.cargo/config.toml` — written at configure time (not a ninja
  // rule), like `bun_dependency_versions.h`. Holds the per-target `linker = `
  // (the discovered clang++ from `tools.ts`) so a contributor running `cargo`
  // directly / rust-analyzer use the same toolchain the ninja build does.
  generateCargoConfig(cfg);
  mark("generateCargoConfig");

  // Perl check: LUT codegen (create-hash-table.ts) shells out to the
  // perl script from JSC. If perl is missing, codegen fails cryptically.
  // Check here so the error is at configure time with a clear hint.
  // rust-only/link-only don't run LUT codegen — skip the check so split-CI
  // steps don't require perl on the rust cross-compile box.
  if (cfg.mode === "full" || cfg.mode === "cpp-only") {
    if (findSystemTool("perl") === undefined) {
      throw new BuildError("perl not found in PATH", {
        hint: "LUT codegen (create-hash-table.ts) needs perl. Install it: apt install perl / brew install perl",
      });
    }
  }
  mark("validate+perl");

  // Glob all source lists — one pass, consistent filesystem snapshot.
  const sources = globAllSources();
  mark("globAllSources");

  // Emit ninja.
  const n = new Ninja({ buildDir: cfg.buildDir });
  registerAllRules(n, cfg);
  emitGeneratorRule(n, cfg, input);
  const output = emitBun(n, cfg, sources);
  mark("emitBun");

  // Default targets. cpp-only sets its own default inside emitBun (archive,
  // no smoke test). Full/link-only: `bun` phony (or stripped file) + `check`.
  // Release builds produce both bun-profile and stripped bun; `bun` is the
  // stripped one. Debug produces bun-debug; `bun` is a phony pointing at it.
  // dsym: darwin release only — pulled into defaults so ninja actually builds
  // it (no other node depends on it, and unlike cmake's POST_BUILD it doesn't
  // auto-trigger).
  if (output.exe !== undefined) {
    const defaultTarget = output.strippedExe !== undefined ? n.rel(output.strippedExe) : "bun";
    const targets = [defaultTarget, "check"];
    if (output.dsym !== undefined) targets.push(n.rel(output.dsym));
    n.default(targets);
  }

  // Write build.ninja (only if changed).
  const changed = await n.write();
  mark("n.write");

  // Pre-create all object file parent directories. Ninja doesn't mkdir;
  // CMake pre-creates CMakeFiles/<target>.dir/* at generate time, we do
  // the same. Derived from output.objects so there's no hidden state —
  // the orchestrator already knows every .o path.
  mkdirAll(output.objects.map(dirname));
  mark("mkdirAll");
  const ninjaFile = resolve(cfg.buildDir, "build.ninja");

  const elapsed = Math.round(performance.now() - start);
  const exe = bunExeName(cfg) + (shouldStrip(cfg) ? " → bun (stripped)" : "");

  return { cfg, output, ninjaFile, env: ccacheEnv(cfg), elapsed, changed, exe };
}
