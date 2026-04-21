/**
 * Build entry point — configure + ninja exec.
 *
 *   bun scripts/build.ts --profile=debug
 *   bun scripts/build.ts --profile=release
 *   bun scripts/build.ts --asan=off test foo.test.ts    # override + build + run
 *   bun scripts/build.ts --target tinycc                # build one dep
 *   bun scripts/build.ts --configure-only               # emit ninja, don't run
 *   bun scripts/build.ts -- --target=browser x.ts       # `--` → rest to runtime
 *
 * Arg routing (see parseArgs): build flags first, then the FIRST arg that
 * isn't a recognized build/ninja flag starts exec-args — it and everything
 * after go to the built binary. `--` forces the cutoff. When exec-args are
 * present, build output is suppressed unless the build fails.
 *
 *   -j/-k/-l/-v                     → ninja
 *   --configure-only, --quiet, --help  → here
 *   --<field>=<v> or --<field> <v>  → here (profile/target/config override)
 *   --<unknown>=<v>                 → error (typo check)
 *   anything else                   → runtime
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  downloadArtifacts,
  isCI,
  packageAndUpload,
  printEnvironment,
  spawnWithAnnotations,
  startGroup,
  uploadArtifacts,
} from "./build/ci.ts";
import { formatConfig, formatConfigUnchanged, type PartialConfig } from "./build/config.ts";
import { configure, type ConfigureResult } from "./build/configure.ts";
import { BuildError } from "./build/error.ts";
import { getProfile } from "./build/profiles.ts";
import { STREAM_FD } from "./build/stream.ts";
import { interactive, nameColor, status } from "./build/tty.ts";

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
  const partial: PartialConfig = args.configFile
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
    // Quiet mode: suppress build output unless the build fails. Enabled by
    // --quiet or automatically when positionals are present (you want to see
    // your test output, not a wall of [N/M] lines above it).
    const quiet = args.quiet || args.execArgs.length > 0;

    // Configure summary. Full block only when build.ninja changed (new
    // profile/flags/sources) — a no-op reconfigure, which happens every
    // run, gets a one-liner. CI always full. Suppressed entirely in quiet
    // mode and during ninja's generator-rule replay (ninja's [N/M] already
    // says "reconfigure").
    if (!quiet && !args.configFile) {
      if (result.changed || result.cfg.ci) {
        const o = result.output;
        process.stderr.write(formatConfig(result.cfg, result.exe) + "\n\n");
        process.stderr.write(
          `${o.deps.length} deps, ${o.codegen?.all.length ?? 0} codegen, ${o.objects.length} objects in ${result.elapsed}ms\n\n`,
        );
      } else {
        process.stderr.write(formatConfigUnchanged(result.exe, result.elapsed) + "\n");
      }
    }

    if (args.configureOnly) {
      // Hint only for manual --configure-only, not generator replay.
      if (!args.configFile) {
        process.stderr.write(`run: ninja -C ${result.cfg.buildDir}\n`);
      }
      return;
    }
    // FD 3 sideband — only when interactive. stream.ts (wrapping deps +
    // zig) writes live output there, bypassing ninja's per-job buffering.
    // A human watching a terminal wants to see cmake configure spew and
    // zig progress in real time. A log file (CI) doesn't —
    // that live output is noise (hundreds of `-- Looking for header.h`
    // lines from cmake). When FD 3 isn't set up, stream.ts falls back to
    // stdout which ninja buffers per-job: deps stay quiet until they
    // finish or fail, failure logs stay compact.
    //
    // Ninja's subprocess spawn only touches FDs 0-2; higher fds inherit
    // through posix_spawn/CreateProcessA. Passing our stderr fd (2) at
    // index STREAM_FD dups it there for the whole ninja process tree.
    //
    // In quiet mode, capture to buffers instead — dumped only on failure.
    const stdio: (number | "inherit" | "pipe")[] = quiet
      ? ["inherit", "pipe", "pipe"]
      : ["inherit", "inherit", "inherit"];
    if (!quiet && interactive) {
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
    if (ninja.status !== 0) {
      if (quiet) {
        if (ninja.stdout) process.stderr.write(ninja.stdout);
        if (ninja.stderr) process.stderr.write(ninja.stderr);
      }
      process.exit(ninja.status ?? 1);
    }

    if (args.execArgs.length === 0) {
      // Closing line on success: when restat prunes most of the graph
      // (local WebKit no-op shows `[1/555] build WebKit` then silence),
      // it's not obvious ninja finished vs. stalled. This disambiguates.
      // Targets named when explicit so it's clear what was actually built.
      const what = args.ninjaTargets.length > 0 ? ` ${args.ninjaTargets.map(t => nameColor(t)).join(", ")}` : "";
      status(`[build]${what} done`);
      process.exit(0);
    }

    // Exec the built binary. result.output.exe is the linked (unstripped)
    // binary — bun-debug for debug, bun-profile for release. That's the one
    // you want for dev iteration (has symbols + assertions in debug).
    const exe = result.output.exe;
    if (exe === undefined) {
      throw new BuildError("Cannot exec: build mode produced no executable", {
        hint: `mode=${result.cfg.mode} builds artifacts, not a runnable binary. Drop the positional args or use --profile=debug.`,
      });
    }
    const child = spawnSync(exe, args.execArgs, { stdio: "inherit" });
    if (child.error) {
      throw new BuildError(`Failed to exec ${exe}`, { cause: child.error });
    }
    // Signal death: re-raise so our parent sees the same signal (shells
    // show "Segmentation fault" etc. based on this, not exit code).
    if (child.signal) {
      process.kill(process.pid, child.signal);
      return;
    }
    process.exit(child.status ?? 0);
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
  /** Explicit ninja targets from --target=X. Empty = use defaults. */
  ninjaTargets: string[];
  /** Just configure, don't run ninja. */
  configureOnly: boolean;
  /** Suppress build output unless it fails. Also auto-enabled when execArgs present. */
  quiet: boolean;
  /** Extra ninja args (e.g. -j8, -v). */
  ninjaArgs: string[];
  /**
   * Args to exec the built binary with. First bare positional and everything
   * after. Empty = just build, don't exec.
   */
  execArgs: string[];
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
 *   --target=<name>           Build a specific ninja target (repeatable)
 *   --configure-only          Emit build.ninja, don't run it
 *   -j<N> / -v / -k<N>        Passed through to ninja
 *   <args...>                 Exec the built binary with these args
 *
 * First bare positional ends flag parsing — everything after goes to the
 * built binary verbatim, so `build.ts test -t foo` passes `-t foo` to bun,
 * not to this parser.
 *
 * Boolean overrides accept: on/off, true/false, yes/no, 1/0.
 */
function parseArgs(argv: string[]): CliArgs {
  let profile = "debug";
  const overrides: PartialConfig = {};
  const ninjaTargets: string[] = [];
  const ninjaArgs: string[] = [];
  const execArgs: string[] = [];
  let configureOnly = false;
  let quiet = false;
  let configFile: string | undefined;
  let inExec = false;

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
    "unifiedSources",
    "timeTrace",
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
    "pgoGenerate",
    "pgoUse",
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (inExec) {
      execArgs.push(arg);
      continue;
    }

    // Ninja passthrough: -j<N>, -v, -k<N>, -l<N>. Short flags only —
    // anything starting with `--` is OURS.
    if (/^-[jklv]/.test(arg)) {
      ninjaArgs.push(arg);
      continue;
    }

    // `--` ends flag parsing — everything after goes to the built binary,
    // even args that would otherwise look like build flags. Use when a
    // runtime flag collides with one of ours (e.g. bun-debug's --target).
    if (arg === "--") {
      inExec = true;
      continue;
    }

    if (arg === "--configure-only") {
      configureOnly = true;
      continue;
    }

    if (arg === "--quiet") {
      quiet = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stderr.write(USAGE);
      process.exit(0);
    }

    // --<key>=<value> or --<key> <value>. Space form consumes next argv.
    // Unknown `--<key>` with no value (e.g. `--watch`) falls through to
    // exec args — those are bun-debug flags, not ours.
    const eq = arg.match(/^--([a-zA-Z][a-zA-Z0-9-]*)(?:=(.*))?$/);
    if (!eq) {
      // Not a --flag at all: first bare positional ends flag parsing.
      // Everything after goes to the built binary verbatim.
      execArgs.push(arg);
      inExec = true;
      continue;
    }
    const rawKey = eq[1]!;
    const key = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const isOurs =
      key === "profile" || key === "target" || key === "configFile" || boolFields.has(key) || stringFields.has(key);

    let value = eq[2];
    if (value === undefined) {
      // No `=`. If this is one of our flags, consume next arg as value.
      // If not (e.g. --print, --watch), it's a bun-debug flag → exec args.
      if (!isOurs) {
        execArgs.push(arg);
        inExec = true;
        continue;
      }
      value = argv[++i];
      if (value === undefined) {
        throw new BuildError(`--${rawKey} requires a value`);
      }
    }

    if (key === "target") {
      ninjaTargets.push(value);
      continue;
    }
    if (key === "configFile") {
      configFile = value;
      configureOnly = true;
      continue;
    }
    if (key === "profile") {
      profile = value;
    } else if (boolFields.has(key)) {
      (overrides as Record<string, boolean>)[key] = parseBool(value);
    } else if (stringFields.has(key)) {
      (overrides as Record<string, string>)[key] = value;
    } else {
      throw new BuildError(`Unknown config field: --${rawKey}`, {
        hint: `Known fields: profile, target, ${[...boolFields, ...stringFields].sort().join(", ")}`,
      });
    }
  }

  return { profile, overrides, ninjaTargets, ninjaArgs, execArgs, configureOnly, quiet, configFile };
}

function parseBool(v: string): boolean {
  const lower = v.toLowerCase();
  if (["on", "true", "yes", "1"].includes(lower)) return true;
  if (["off", "false", "no", "0"].includes(lower)) return false;
  throw new BuildError(`Invalid boolean value: ${v}`, { hint: "Use on/off, true/false, yes/no, or 1/0" });
}

const USAGE = `\
Usage: bun scripts/build.ts [options] [exec-args...]

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
  --target=<name>         Build a specific ninja target (repeatable)
  --configure-only        Emit build.ninja, don't run it
  -j<N>, -v, -k<N>        Passed through to ninja
  --help                  Show this help

Any bare positional and everything after is passed to the built binary:
  bun scripts/build.ts test foo.test.ts   → builds, then runs
                                            ./build/debug/bun-debug test foo.test.ts

Examples:
  bun scripts/build.ts --profile=debug
  bun scripts/build.ts --profile=release --lto=off
  bun scripts/build.ts test foo.test.ts
  bun scripts/build.ts --profile=debug-local run script.ts
  bun scripts/build.ts --target=bun-zig
  bun scripts/build.ts --configure-only
`;
