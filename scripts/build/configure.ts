/**
 * Configure: resolve config → emit build.ninja.
 *
 * Separated from build.ts so configure can be called standalone (just
 * regenerate ninja without running the build) and so CI orchestration
 * can configure once then run specific targets.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type BunOutput, bunExeName, emitBun, shouldStrip, validateBunConfig } from "./bun.ts";
import {
  type Config,
  type PartialConfig,
  type Toolchain,
  detectHost,
  findRepoRoot,
  formatConfig,
  resolveConfig,
} from "./config.ts";
import { BuildError } from "./error.ts";
import { mkdirAll, writeIfChanged } from "./fs.ts";
import { Ninja } from "./ninja.ts";
import { registerAllRules } from "./rules.ts";
import { quote } from "./shell.ts";
import { globAllSources } from "./sources.ts";
import { findBun, findCargo, findMsvcLinker, findSystemTool, resolveLlvmToolchain } from "./tools.ts";

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

  // esbuild/zig paths are relative to REPO ROOT, not process.cwd() — when
  // ninja's generator rule invokes reconfigure, cwd is the build dir.
  const repoRoot = findRepoRoot();

  // esbuild — comes from the root bun install. Path is deterministic.
  // If not present, the first codegen build will fail with a clear error
  // (and the build itself runs `bun install` first via the root install
  // stamp, so this path will exist by the time esbuild rules fire).
  const esbuild = resolve(repoRoot, "node_modules", ".bin", host.os === "windows" ? "esbuild.exe" : "esbuild");

  // zig — lives at vendor/zig/, downloaded by the zig_fetch rule.
  // Same deal: path is deterministic, download happens at build time.
  const zig = resolve(repoRoot, "vendor", "zig", host.os === "windows" ? "zig.exe" : "zig");

  return {
    ...llvm,
    cmake,
    zig,
    bun: findBun(host.os),
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

  // Bun.Glob — node:fs globSync isn't in older bun versions (CI agents pin).
  const glob = (pattern: string) => [...new Bun.Glob(pattern).scanSync({ cwd: buildDir })];
  const scripts = glob("*.ts")
    .filter(f => !excluded.has(f))
    .map(f => resolve(buildDir, f));
  const deps = glob("deps/*.ts").map(f => resolve(buildDir, f));

  return [...scripts, ...deps, resolve(cwd, "cmake", "Sources.json"), resolve(cwd, "package.json")].sort();
}

/**
 * Emit the generator rule — makes build.ninja self-rebuilding. When you
 * run `ninja` directly and a build script has changed, ninja runs
 * reconfigure first, then restarts with the fresh graph.
 *
 * The original PartialConfig is persisted to configure.json; the regen
 * command reads it back via --config-file. This ensures the replay uses
 * the exact same profile/overrides as the original configure.
 */
function emitGeneratorRule(n: Ninja, cfg: Config, partial: PartialConfig): void {
  const configFile = resolve(cfg.buildDir, "configure.json");
  const buildScript = resolve(cfg.cwd, "scripts", "build.ts");

  // Persist the partial config. writeIfChanged — same config → no mtime
  // bump → no unnecessary regen on identical reconfigures.
  // This runs before n.write() (which mkdir's), so ensure dir exists.
  mkdirSync(cfg.buildDir, { recursive: true });
  writeIfChanged(configFile, JSON.stringify(partial, null, 2) + "\n");

  const hostWin = cfg.host.os === "windows";
  n.rule("regen", {
    command: `${quote(cfg.bun, hostWin)} ${quote(buildScript, hostWin)} --config-file=$in`,
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
 * ccache environment to set for compile commands. Points ccache into the
 * build dir (not ~/.ccache) so `rm -rf build/` is a complete reset.
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
 * `partial` comes from a profile + CLI overrides. If no buildDir is set,
 * one is computed from the build type (build/debug, build/release, etc).
 */
export async function configure(partial: PartialConfig): Promise<ConfigureResult> {
  const start = performance.now();
  const trace = process.env.BUN_BUILD_TRACE === "1";
  const mark = (label: string) => {
    if (trace) process.stderr.write(`  ${label}: ${Math.round(performance.now() - start)}ms\n`);
  };

  const toolchain = resolveToolchain();
  mark("resolveToolchain");
  const cfg = resolveConfig(partial, toolchain);

  validateBunConfig(cfg);

  // Perl check: LUT codegen (create-hash-table.ts) shells out to the
  // perl script from JSC. If perl is missing, codegen fails cryptically.
  // Check here so the error is at configure time with a clear hint.
  // zig-only/link-only don't run LUT codegen — skip the check so split-CI
  // steps don't require perl on the zig cross-compile box.
  if (cfg.mode === "full" || cfg.mode === "cpp-only") {
    if (findSystemTool("perl") === undefined) {
      throw new BuildError("perl not found in PATH", {
        hint: "LUT codegen (create-hash-table.ts) needs perl. Install it: apt install perl / brew install perl",
      });
    }
  }
  mark("validate+perl");

  // Glob all source lists — one pass, consistent filesystem snapshot.
  const sources = globAllSources(cfg.cwd);
  mark("globAllSources");

  // Emit ninja.
  const n = new Ninja({ buildDir: cfg.buildDir });
  registerAllRules(n, cfg);
  emitGeneratorRule(n, cfg, partial);
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

  // Full config print only when build.ninja actually changed (new
  // profile, changed flags, new revision, new sources). A no-op
  // reconfigure — which happens every run — gets a one-liner from
  // build.ts (not here, because we're also called by ninja's generator
  // rule and don't want doubled output). CI always prints.
  if (changed || cfg.ci) {
    process.stderr.write(formatConfig(cfg, exe) + "\n\n");
    const codegenCount = output.codegen?.all.length ?? 0;
    process.stderr.write(
      `${output.deps.length} deps, ${codegenCount} codegen, ${output.objects.length} objects in ${elapsed}ms\n\n`,
    );
  }

  return { cfg, output, ninjaFile, env: ccacheEnv(cfg), elapsed, changed, exe };
}
