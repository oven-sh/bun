#!/usr/bin/env bun
/**
 * Build entry point — configure + ninja exec.
 *
 *   bun scripts/build.ts --profile=debug
 *   bun scripts/build.ts --profile=release
 *   bun scripts/build.ts --profile=debug --asan=off     # override a field
 *   bun scripts/build.ts --profile=debug -- bun-zig      # specific ninja target
 *   bun scripts/build.ts --configure-only                # emit ninja, don't run
 *
 * Replaces scripts/build.mjs. The old CMake build is still available via
 * `bun run build:cmake:*` scripts in package.json.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isatty } from "node:tty";
import {
  downloadArtifacts,
  isCI,
  packageAndUpload,
  printEnvironment,
  spawnWithAnnotations,
  startGroup,
  uploadArtifacts,
} from "./build/ci.ts";
import { formatConfigUnchanged, type PartialConfig } from "./build/config.ts";
import { configure, type ConfigureResult } from "./build/configure.ts";
import { BuildError } from "./build/error.ts";
import { getProfile } from "./build/profiles.ts";
import { STREAM_FD } from "./build/stream.ts";

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

try {
  await main();
} catch (err) {
  if (err instanceof BuildError) {
    process.stderr.write(err.format());
    process.exit(1);
  }
  throw err;
}

async function main(): Promise<void> {
  // Windows: re-exec inside the VS dev shell if not already there.
  // The shell provides PATH (mt.exe, rc.exe, cl.exe), INCLUDE, LIB,
  // WindowsSdkDir — things clang-cl can mostly self-detect but nested
  // cmake projects can't. Cheap: VSINSTALLDIR check short-circuits on
  // subsequent runs in the same terminal.
  if (process.platform === "win32" && !process.env.VSINSTALLDIR) {
    const vsShell = join(import.meta.dirname, "vs-shell.ps1");
    const result = spawnSync(
      "pwsh",
      ["-NoProfile", "-NoLogo", "-File", vsShell, process.argv0, import.meta.filename, ...process.argv.slice(2)],
      { stdio: "inherit" },
    );
    if (result.error) {
      throw new BuildError(`Failed to spawn pwsh`, {
        cause: result.error,
        hint: "Is PowerShell 7+ (pwsh) installed?",
      });
    }
    process.exit(result.status ?? 1);
  }

  const args = parseArgs(process.argv.slice(2));

  // Resolve PartialConfig: either from --config-file (ninja's generator rule
  // replaying a previous configure) or from --profile + overrides (normal use).
  const partial: PartialConfig =
    args.configFile !== undefined
      ? loadConfigFile(args.configFile)
      : { ...getProfile(args.profile), ...args.overrides };

  const ninjaArgv = (cfg: { buildDir: string }) => ["-C", cfg.buildDir, ...args.ninjaArgs, ...args.ninjaTargets];
  const ninjaEnv = (env: Record<string, string>) => ({ ...process.env, ...env });

  if (isCI) {
    // CI: machine/env dump + collapsible groups + annotation-on-failure.
    printEnvironment();
    const result = (await startGroup("Configure", () => configure(partial))) as ConfigureResult;
    if (args.configureOnly) return;

    // link-only: download cpp-only + zig-only artifacts before ninja.
    if (result.cfg.buildkite && result.cfg.mode === "link-only") {
      await startGroup("Download artifacts", () => downloadArtifacts(result.cfg));
    }

    await startGroup("Build", () =>
      spawnWithAnnotations("ninja", ninjaArgv(result.cfg), { label: "ninja", env: ninjaEnv(result.env) }),
    );

    // cpp-only/zig-only: upload build outputs for downstream link-only.
    // link-only: package + upload zips for downstream test steps.
    if (result.cfg.buildkite) {
      if (result.cfg.mode === "cpp-only" || result.cfg.mode === "zig-only") {
        await startGroup("Upload artifacts", () => uploadArtifacts(result.cfg, result.output));
      }
      if (result.cfg.mode === "link-only") {
        await startGroup("Package and upload", () => packageAndUpload(result.cfg, result.output));
      }
    }
  } else {
    // Local: configure, then spawn ninja.
    const result = await configure(partial);

    // Quiet one-liner when configure was a no-op — the full banner only
    // prints when build.ninja changed. Timing matters: a regression here
    // would otherwise be invisible. Suppressed for ninja's generator-
    // rule replay (--config-file) since ninja's [N/M] already says
    // "reconfigure" and doubling it is noise.
    if (!result.changed && args.configFile === undefined) {
      process.stderr.write(formatConfigUnchanged(result.exe, result.elapsed) + "\n");
    }

    if (args.configureOnly) {
      // Hint only for manual --configure-only, not generator replay.
      if (args.configFile === undefined) {
        process.stderr.write(`run: ninja -C ${result.cfg.buildDir}\n`);
      }
      return;
    }
    // FD 3 sideband — only when interactive. stream.ts (wrapping deps +
    // zig) writes live output there, bypassing ninja's per-job buffering.
    // A human watching a terminal wants to see cmake configure spew and
    // zig progress in real time. A log file (scripts/bd, CI) doesn't —
    // that live output is noise (hundreds of `-- Looking for header.h`
    // lines from cmake). When FD 3 isn't set up, stream.ts falls back to
    // stdout which ninja buffers per-job: deps stay quiet until they
    // finish or fail, failure logs stay compact.
    //
    // Ninja's subprocess spawn only touches FDs 0-2; higher fds inherit
    // through posix_spawn/CreateProcessA. Passing our stderr fd (2) at
    // index STREAM_FD dups it there for the whole ninja process tree.
    const stdio: (number | "inherit")[] = ["inherit", "inherit", "inherit"];
    if (isatty(2)) {
      stdio[STREAM_FD] = 2;
    }
    const ninja = spawnSync("ninja", ninjaArgv(result.cfg), {
      stdio,
      env: ninjaEnv(result.env),
    });
    if (ninja.error) {
      process.stderr.write(`Failed to exec ninja: ${ninja.error.message}\nIs ninja in your PATH?\n`);
      process.exit(127);
    }
    // Closing line on success: when restat prunes most of the graph
    // (local WebKit no-op shows `[1/555] build WebKit` then silence),
    // it's not obvious ninja finished vs. stalled. This disambiguates.
    // Always shown — useful for piped/CI too as an end-of-build marker.
    if (ninja.status === 0) {
      const clear = isatty(2) ? "\r\x1b[K" : "";
      process.stderr.write(`${clear}[build] done\n`);
    }
    process.exit(ninja.status ?? 1);
  }
}

/** Load a PartialConfig from JSON (for ninja's generator rule replay). */
function loadConfigFile(path: string): PartialConfig {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PartialConfig;
  } catch (cause) {
    throw new BuildError(`Failed to load config file: ${path}`, { cause });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// CLI arg parsing
// ───────────────────────────────────────────────────────────────────────────

interface CliArgs {
  profile: string;
  /** PartialConfig overrides from --<field>=<value> flags. */
  overrides: PartialConfig;
  /** Explicit ninja targets after `--`. Empty = use defaults. */
  ninjaTargets: string[];
  /** Just configure, don't run ninja. */
  configureOnly: boolean;
  /** Extra ninja args (e.g. -j8, -v). */
  ninjaArgs: string[];
  /**
   * Load PartialConfig from JSON (ninja's generator rule replay).
   * Mutually exclusive with --profile/overrides.
   */
  configFile: string | undefined;
}

/**
 * Parse argv. Format:
 *   --profile=<name>          Profile (required, no default here — caller picks)
 *   --<field>=<value>         Override any PartialConfig boolean/string field
 *   --configure-only          Emit build.ninja, don't run it
 *   -j<N> / -v / -k<N>        Passed through to ninja
 *   -- <targets...>           Explicit ninja targets
 *
 * Boolean overrides accept: on/off, true/false, yes/no, 1/0.
 */
function parseArgs(argv: string[]): CliArgs {
  let profile = "debug";
  const overrides: PartialConfig = {};
  const ninjaTargets: string[] = [];
  const ninjaArgs: string[] = [];
  let configureOnly = false;
  let configFile: string | undefined;
  let inTargets = false;

  // PartialConfig fields that are BOOLEANS. Used for value coercion.
  // Not exhaustive — add as needed. Unknown --<field> is rejected so you
  // notice typos.
  const boolFields = new Set([
    "lto",
    "asan",
    "zigAsan",
    "assertions",
    "logs",
    "baseline",
    "canary",
    "staticSqlite",
    "staticLibatomic",
    "tinycc",
    "valgrind",
    "fuzzilli",
    "ci",
    "buildkite",
  ]);
  // PartialConfig fields that are STRINGS.
  const stringFields = new Set([
    "os",
    "arch",
    "abi",
    "buildType",
    "mode",
    "webkit",
    "buildDir",
    "cacheDir",
    "nodejsVersion",
    "nodejsAbiVersion",
    "zigCommit",
    "webkitVersion",
  ]);

  for (const arg of argv) {
    if (inTargets) {
      ninjaTargets.push(arg);
      continue;
    }
    if (arg === "--") {
      inTargets = true;
      continue;
    }

    // Ninja passthrough: -j<N>, -v, -k<N>, -l<N>. Short flags only —
    // anything starting with `--` is OURS.
    if (/^-[jklv]/.test(arg)) {
      ninjaArgs.push(arg);
      continue;
    }

    if (arg === "--configure-only") {
      configureOnly = true;
      continue;
    }

    if (arg.startsWith("--config-file=")) {
      configFile = arg.slice("--config-file=".length);
      configureOnly = true; // --config-file is only used by ninja's regen; never runs ninja
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stderr.write(USAGE);
      process.exit(0);
    }

    // --<field>=<value>
    const m = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)=(.*)$/);
    if (!m) {
      throw new BuildError(`Unknown argument: ${arg}`, { hint: USAGE });
    }
    const [, rawKey, value] = m;
    const key = rawKey!.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()); // kebab → camel

    if (key === "profile") {
      profile = value!;
    } else if (boolFields.has(key)) {
      (overrides as Record<string, boolean>)[key] = parseBool(value!);
    } else if (stringFields.has(key)) {
      (overrides as Record<string, string>)[key] = value!;
    } else {
      throw new BuildError(`Unknown config field: --${rawKey}`, {
        hint: `Known fields: profile, ${[...boolFields, ...stringFields].sort().join(", ")}`,
      });
    }
  }

  return { profile, overrides, ninjaTargets, ninjaArgs, configureOnly, configFile };
}

function parseBool(v: string): boolean {
  const lower = v.toLowerCase();
  if (["on", "true", "yes", "1"].includes(lower)) return true;
  if (["off", "false", "no", "0"].includes(lower)) return false;
  throw new BuildError(`Invalid boolean value: ${v}`, { hint: "Use on/off, true/false, yes/no, or 1/0" });
}

const USAGE = `\
Usage: bun scripts/build.ts [options] [-- ninja-targets...]

Options:
  --profile=<name>        Build profile (default: debug)
                          Profiles: debug, debug-local, debug-no-asan,
                                    release, release-local, release-asan,
                                    release-assertions, ci-*
  --<field>=<value>       Override a config field. Boolean fields take
                          on/off/true/false/yes/no/1/0.
                          Fields: asan, lto, assertions, logs, baseline,
                                  canary, valgrind, webkit (prebuilt|local),
                                  buildDir, mode (full|cpp-only|link-only)
  --configure-only        Emit build.ninja, don't run it
  -j<N>, -v, -k<N>        Passed through to ninja
  --                      Everything after is a ninja target
  --help                  Show this help

Examples:
  bun scripts/build.ts --profile=debug
  bun scripts/build.ts --profile=release --lto=off
  bun scripts/build.ts --profile=debug -- bun-zig
  bun scripts/build.ts --configure-only
`;
