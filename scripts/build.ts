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
 *   -j/-k/-l/-v/-n, -d <mode>       → ninja
 *   -t <tool> [args…]               → the ninja tool, on the build directory as it is (no configure, no build)
 *   --configure-only, --quiet, --help  → here
 *   --timings                       → here: after the build, where the build directory's time went (build/timings.ts)
 *   --<field>=<v> or --<field> <v>  → here (profile/target/config override)
 *   --<unknown>=<v>                 → error (typo check)
 *   anything else                   → runtime
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  inheritOrderFile,
  orderFileContext,
  orderFileEligible,
  packageAndUpload,
  publishTimings,
  reportNothingToInherit,
  spawnWithAnnotations,
  timingsChartName,
} from "./build/ci.ts";
import { formatConfig, formatConfigUnchanged, type Config, type PartialConfig } from "./build/config.ts";
import {
  codegenConfigOf,
  configOf,
  configure,
  configureCodegen,
  modeOf,
  reconfigure,
  reconfigureCodegen,
  type ConfigureInput,
} from "./build/configure.ts";
import { BuildError } from "./build/error.ts";
import { ninjaIfPresent } from "./build/ninja-release.ts";
import { STREAM_FD } from "./build/stream.ts";
import { chartHtml, formatReport, loadBuild } from "./build/timings.ts";
import { bold, dim, interactive, nameColor, status } from "./build/tty.ts";
import { isBuildkite, isCI, printEnvironment, startGroup } from "./buildkite.ts";

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

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

  // A ninja tool (`-t query <target>`, `-t deps <object>`, `-t commands`, …) inspects what the last configure and
  // build left behind, so it runs on the build directory as it is, with the ninja the build runs.
  if (args.ninjaTool !== undefined) {
    const toolInput: ConfigureInput = { profile: args.profile, overrides: args.overrides };
    const cfg = modeOf(toolInput) === "codegen" ? codegenConfigOf(toolInput) : configOf(toolInput).cfg;
    if (!existsSync(join(cfg.buildDir, "build.ninja"))) {
      throw new BuildError(`${cfg.buildDir} has not been configured`, {
        hint: "Build it, or configure it with --configure-only, using the same profile flags.",
      });
    }
    const tool = spawnSync(ninjaIfPresent(cfg), ["-C", cfg.buildDir, "-t", ...args.ninjaTool], { stdio: "inherit" });
    if (tool.error) throw new BuildError(`Failed to run ninja`, { cause: tool.error });
    process.exit(tool.status ?? 1);
  }

  // Skip on --configure-only / --config-file (ninja regen): those paths
  // return before spawning ninja, so the NO_PROXY mutation can't reach any
  // child and would be pure wasted wall-clock (up to 2s behind a
  // silent-drop firewall).
  if (!args.configureOnly) {
    await maybeBypassProxyForCratesIo();
  }

  // Resolve ConfigureInput: either from --config-file (ninja's generator rule
  // replaying a previous configure) or from --profile + overrides (normal use).
  // We pass the *unresolved* {profile, overrides} pair through — configure()
  // expands the profile itself and persists the unresolved form, so editing
  // profiles.ts propagates to existing build dirs on the next regen instead
  // of being frozen at first-configure time.
  const input: ConfigureInput = args.configFile
    ? loadConfigFile(args.configFile)
    : { profile: args.profile, overrides: args.overrides };

  const ninjaArgv = (cfg: { buildDir: string }) => ["-C", cfg.buildDir, ...args.ninjaArgs, ...args.ninjaTargets];
  // GNU-style include-path vars (CPATH, C_INCLUDE_PATH, CPLUS_INCLUDE_PATH,
  // OBJC_INCLUDE_PATH) apply to every clang invocation regardless of
  // --target. A build environment may set them for the *host* gcc toolchain
  // (a machine set up for a gcc toolchain does), which hijacks <vector> & co. away from the MSVC
  // STL when cross-compiling for Windows ("'bits/c++config.h' file not
  // found"). Scrub them for Windows cross builds — they are host-targeted by
  // definition. Native Windows builds (INCLUDE/LIB from the VS dev shell) and
  // every other target keep the environment as provisioned.
  const ninjaEnv = (cfg: { windows: boolean; host: { os: string } }, env: Record<string, string>) => {
    const merged: NodeJS.ProcessEnv = { ...process.env, ...env };
    if (cfg.windows && cfg.host.os !== "windows") {
      for (const name of ["CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH", "OBJC_INCLUDE_PATH"]) {
        delete merged[name];
      }
    }
    return merged;
  };

  if (args.configFile !== undefined) {
    // ninja's generator rule replaying a previous configure (`regen`, configure.ts): just rewrite build.ninja.
    // ninja's own [N/M] line already says "reconfigure"; the CI prelude and the local summary would be noise
    // in the middle of a build log.
    await (modeOf(input) === "codegen" ? reconfigureCodegen(input) : reconfigure(input));
    return;
  }

  // mode=codegen: the code generators and nothing else. No toolchain was looked for, and none of what the two
  // paths below do around a native build (artifacts, the symbol order file, a binary to run) applies.
  if (modeOf(input) === "codegen") {
    if (args.execArgs.length > 0) {
      throw new BuildError("mode=codegen builds no binary to run", { hint: "Drop the positional args." });
    }
    const result = await configureCodegen(input);
    if (!args.quiet) {
      process.stderr.write(`codegen only → ${result.cfg.codegenDir} (configured in ${result.elapsed}ms)\n`);
    }
    if (args.configureOnly) return;
    const ninja = spawnSync(result.ninja, ninjaArgv(result.cfg), { stdio: "inherit" });
    if (ninja.error) throw new BuildError("Failed to run ninja", { cause: ninja.error });
    process.exit(ninja.status ?? 1);
  }

  if (isCI) {
    // CI: machine/env dump + collapsible groups + annotation-on-failure.
    printEnvironment();
    const result = await startGroup("Configure", () => configure(input));
    if (args.configureOnly) return;

    // The order file is a link input, so it must land before the linking ninja pass.
    const orderCtx = orderFileContext();
    const runInherit = () =>
      inheritOrderFile(result.cfg, orderCtx).catch(e => {
        console.log(`~ symbol order: inherit failed (${(e as Error)?.message ?? e}); linking unordered`);
        return false;
      });
    const ninja = result.ninja;
    const runNinja = (targets: string[] = args.ninjaTargets) =>
      spawnWithAnnotations(ninja, ["-C", result.cfg.buildDir, ...args.ninjaArgs, ...targets], {
        label: "ninja",
        env: ninjaEnv(result.cfg, result.env),
      });

    const inherited = (await startGroup("Inherit symbol order file", runInherit)) as boolean;

    await startGroup("Build", () => runNinja());

    // No build traces its own binary: the order file is the one a main build's trace-order step published
    // (see "Symbol ordering file" in ci.ts).
    if (orderFileEligible(result.cfg, orderCtx) && result.output.exe && !inherited) {
      reportNothingToInherit(result.cfg);
    }

    // Every CI build says where its time went: nobody can come back to this build directory to ask.
    // It describes a build that already succeeded, so here it never fails one: what goes wrong is printed and the
    // artifacts still upload.
    startGroup("Build timings", () => {
      try {
        reportTimings(result.cfg, t => process.stdout.write(t));
      } catch (error) {
        console.log(error instanceof BuildError ? error.format() : `build timings: ${(error as Error).stack ?? error}`);
      }
    });

    // Package + upload zips for downstream test steps.
    if (result.cfg.buildkite && result.cfg.mode === "archive-link") {
      await startGroup("Package and upload", () => packageAndUpload(result.cfg, result.output));
    }
  } else {
    // Local: configure, then spawn ninja.
    const result = await configure(input);

    // Quiet one-liner when configure was a no-op — the full banner only
    // prints when build.ninja changed. Timing matters: a regression here
    // would otherwise be invisible. Suppressed for ninja's generator-
    // rule replay (--config-file) since ninja's [N/M] already says
    // "reconfigure" and doubling it is noise.
    // Quiet mode: suppress build output unless the build fails. Enabled by
    // --quiet or automatically when positionals are present (you want to see
    // your test output, not a wall of [N/M] lines above it).
    // Not with -n, -d <mode> or -v: what ninja prints is what those were asked for.
    const quiet = (args.quiet || args.execArgs.length > 0) && !args.ninjaArgs.some(a => /^-[ndv]/.test(a));

    // Configure summary. Full block only when build.ninja changed (new
    // profile/flags/sources) — a no-op reconfigure, which happens every
    // run, gets a one-liner. CI always full. Suppressed entirely in quiet
    // mode.
    if (!quiet) {
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
      // The report describes the build directory, so it needs no build: this is how to ask for it without one.
      if (args.timings) reportTimings(result.cfg, t => process.stderr.write(t));
      return;
    }
    // FD 3 sideband — only when interactive. stream.ts (wrapping deps and
    // the cargo plan) writes live output there, bypassing ninja's per-job buffering.
    // A human watching a terminal wants to see cmake configure spew and
    // cargo's download progress in real time. A log file (CI) doesn't —
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
    const ninja = spawnSync(result.ninja, ninjaArgv(result.cfg), {
      stdio,
      env: ninjaEnv(result.cfg, result.env),
      // Captured output (quiet mode) can be tens of MB on a cold build; the default 1 MB maxBuffer ENOBUFSes.
      maxBuffer: 1024 * 1024 * 1024,
    });
    if (ninja.error) {
      const hint =
        result.ninja === "ninja"
          ? "Is ninja in your PATH?"
          : "That is the ninja release the build pins. If the file is damaged, delete its directory and the next build fetches it again.";
      process.stderr.write(`Failed to exec ${result.ninja}: ${ninja.error.message}\n${hint}\n`);
      process.exit(127);
    }
    if (ninja.status !== 0) {
      if (quiet) {
        if (ninja.stdout) process.stderr.write(ninja.stdout);
        if (ninja.stderr) process.stderr.write(ninja.stderr);
      }
      process.exit(ninja.status ?? 1);
    }

    if (args.timings) reportTimings(result.cfg, t => process.stderr.write(t));

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

/**
 * `--timings`, and every CI build: print where the build directory's time went, and write the same as a chart. Under
 * Buildkite the chart is uploaded and the build page links to it.
 */
function reportTimings(cfg: Config, write: (text: string) => void): void {
  const build = loadBuild(cfg);
  write(formatReport(build, { bold, dim }));
  if (build.runs.length === 0) return;
  const chart = join(cfg.buildDir, timingsChartName());
  writeFileSync(chart, chartHtml(build));
  write(`\n${bold("chart")}  ${relative(process.cwd(), chart)}\n`);
  if (isBuildkite) publishTimings(cfg, chart);
}

/**
 * When an HTTP proxy is configured, cargo's `-Zbuild-std` (release lolhtml)
 * must reach crates.io. Some CI/corporate proxies 403 CONNECT to package
 * registries while direct egress is open. If a proxy is set and crates.io
 * isn't already exempted, probe direct connectivity once: if it works, add
 * crates.io to NO_PROXY so cargo goes direct. If the probe fails (mandatory-
 * egress-proxy topology, firewall drops direct), leave NO_PROXY untouched so
 * cargo keeps using the proxy. Runs once per build; propagates to all ninja
 * children via process.env.
 */
async function maybeBypassProxyForCratesIo(): Promise<void> {
  const proxySet =
    process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  if (!proxySet) return;

  // Both case variants are honoured by different tools; merge them so we
  // don't clobber one when writing the unified value back to both.
  const bypass = new Set<string>();
  for (const v of [process.env.NO_PROXY, process.env.no_proxy]) {
    for (const entry of (v ?? "").split(",")) {
      const t = entry.trim();
      if (t) bypass.add(t);
    }
  }
  if (bypass.has("crates.io")) return;

  const { connect } = await import("node:net");
  const directReachable = await new Promise<boolean>(resolve => {
    const sock = connect({ host: "index.crates.io", port: 443, timeout: 2000 });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
  if (!directReachable) return;

  for (const h of ["crates.io", "static.crates.io", "index.crates.io"]) bypass.add(h);
  const merged = [...bypass].join(",");
  process.env.NO_PROXY = merged;
  process.env.no_proxy = merged;
}

/**
 * Load a ConfigureInput from JSON (for ninja's generator rule replay).
 *
 * Current format: `{ profile?: string, overrides?: PartialConfig }`.
 * Legacy format (pre profile-name persistence): a flat PartialConfig — if we
 * see neither `profile` nor `overrides` keys, wrap the whole object as
 * overrides so old build dirs still regen.
 */
function loadConfigFile(path: string): ConfigureInput {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (cause) {
    throw new BuildError(`Failed to load config file: ${path}`, { cause });
  }
  if ("profile" in raw || "overrides" in raw) {
    return raw as ConfigureInput;
  }
  // Legacy flat PartialConfig.
  return { overrides: raw as PartialConfig };
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
  /** After the build (with `configureOnly`: without one), report where the build directory's time went. */
  timings: boolean;
  /** Extra ninja args (e.g. -j8, -v, -n, -d explain). */
  ninjaArgs: string[];
  /** `-t <tool> [args…]`: run this ninja tool instead of configuring and building. */
  ninjaTool: string[] | undefined;
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

/** How a `--<field>=<value>` is read, which the field's type decides. */
type ConfigFlagKind<T> = [T] extends [boolean] ? "boolean" : [T] extends [number] ? "number" : "string";

/**
 * Every `PartialConfig` field is a `--<field>` flag. The mapped type makes this list complete and correct by
 * construction: a field added to `PartialConfig` without an entry here, or listed with the wrong kind, does not
 * compile.
 */
const configFlags: { [K in keyof Required<PartialConfig>]: ConfigFlagKind<NonNullable<PartialConfig[K]>> } = {
  os: "string",
  arch: "string",
  abi: "string",
  buildType: "string",
  mode: "string",
  lto: "boolean",
  pgoGenerate: "string",
  pgoUse: "string",
  asan: "boolean",
  assertions: "boolean",
  logs: "boolean",
  baseline: "boolean",
  canary: "boolean",
  staticSqlite: "boolean",
  staticLibatomic: "boolean",
  tinycc: "boolean",
  valgrind: "boolean",
  fuzzilli: "boolean",
  socketFaultInjection: "boolean",
  unifiedSources: "boolean",
  archiveDeps: "boolean",
  timeTrace: "boolean",
  ci: "boolean",
  buildkite: "boolean",
  webkit: "string",
  localDeps: "string",
  packageManager: "string",
  buildDir: "string",
  cacheDir: "string",
  androidNdk: "string",
  androidApiLevel: "number",
  freebsdSysroot: "string",
  freebsdVersion: "string",
  linuxSysroot: "string",
  portable: "boolean",
  portableSysroot: "string",
  macosSdk: "string",
  osxDeploymentTarget: "string",
  winsysroot: "string",
  nodejsVersion: "string",
  nodejsAbiVersion: "string",
  nodejsV8Version: "string",
  webkitVersion: "string",
};

/** `ninja -d list` */
const ninjaDebugModes = new Set(["stats", "explain", "keepdepfile", "keeprsp", "nostatcache", "list"]);

/**
 * Parse argv. Format:
 *   --profile=<name>          Profile (required, no default here — caller picks)
 *   --<field>=<value>         Override any PartialConfig field (configFlags)
 *   --target=<name>           Build a specific ninja target (repeatable)
 *   --configure-only          Emit build.ninja, don't run it
 *   --timings                 After the build, report where the build directory's time went
 *   -j<N> / -v / -k<N> / -n / -d <mode>   Passed through to ninja
 *   -t <tool> [args…]         Run a ninja tool on the build directory; everything after -t is the tool's
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
  let ninjaTool: string[] | undefined;
  const execArgs: string[] = [];
  let configureOnly = false;
  let quiet = false;
  let timings = false;
  let configFile: string | undefined;
  let inExec = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (inExec) {
      execArgs.push(arg);
      continue;
    }

    // A ninja tool: it and everything after it are ninja's (a tool's arguments are positionals).
    if (arg === "-t") {
      ninjaTool = argv.slice(i + 1);
      break;
    }

    // Ninja passthrough: -j<N>, -v, -k<N>, -l<N>, -n, -d <mode>. Short flags only —
    // anything starting with `--` is OURS. `-d` is ninja's only with one of ninja's debug modes after it:
    // bun's own `-d K:V` (--define) keeps reaching the built binary.
    if (arg === "-d" && ninjaDebugModes.has(argv[i + 1] ?? "")) {
      ninjaArgs.push(arg, argv[++i]!);
      continue;
    }
    if (/^-[jklvn]/.test(arg)) {
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

    if (arg === "--timings") {
      timings = true;
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
    const kind = Object.hasOwn(configFlags, key) ? configFlags[key as keyof PartialConfig] : undefined;
    const isOurs = key === "profile" || key === "target" || key === "configFile" || kind !== undefined;

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
    } else if (kind === undefined) {
      throw new BuildError(`Unknown config field: --${rawKey}`, {
        hint: `Known fields: profile, target, ${Object.keys(configFlags).sort().join(", ")}`,
      });
    } else {
      // The value's type follows `kind`, which `configFlags` ties to the field's declared type.
      (overrides as Record<string, boolean | number | string>)[key] =
        kind === "boolean" ? parseBool(value) : kind === "number" ? parseInteger(rawKey, value) : value;
    }
  }

  return {
    profile,
    overrides,
    ninjaTargets,
    ninjaArgs,
    ninjaTool,
    execArgs,
    configureOnly,
    quiet,
    timings,
    configFile,
  };
}

function parseInteger(flag: string, v: string): number {
  if (!/^\d+$/.test(v)) throw new BuildError(`--${flag} takes a non-negative integer, got: ${JSON.stringify(v)}`);
  return Number(v);
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
                                    release-assertions, ci-*,
                                    windows-{x64,arm64}[-release] (cross-compile
                                    from a non-Windows host)
  --<field>=<value>       Override a config field. Boolean fields take
                          on/off/true/false/yes/no/1/0.
                          Fields: asan, lto, assertions, logs, baseline,
                                  canary, valgrind, webkit (prebuilt|local),
                                  local-deps (name=path[,name=path] — build a
                                  vendored dep from a local checkout),
                                  package-manager (bun|npm, installs the
                                  package.json files the build needs),
                                  buildDir, mode (full|archive-link|codegen),
                                  unifiedSources, timeTrace, os, arch, abi,
                                  winsysroot (Windows cross-compile SDK root),
                                  portable + portable-sysroot (the static-pie
                                  "portable image", linux-x64)
  --target=<name>         Build a specific ninja target (repeatable)
  --configure-only        Emit build.ninja, don't run it
  --timings               After the build (or, with --configure-only, without
                          one), report where the time went: totals per rule,
                          the slowest edges, the critical path, and how
                          parallel the last build was; and write the same as
                          a chart. It describes the build
                          directory (the last time every edge ran), so it
                          reads the same after a build with nothing to do.
                          With --time-trace=on, the compilers' phases too.
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
  bun scripts/build.ts --local-deps=mimalloc=~/code/mimalloc test foo.test.ts
  bun scripts/build.ts --target=bun-rust
  bun scripts/build.ts --configure-only
`;

// Entry point — must run after all module-level declarations (USAGE) are
// initialized, otherwise parseArgs hits a TDZ ReferenceError on --help.
try {
  await main();
} catch (err) {
  if (err instanceof BuildError) {
    process.stderr.write(err.format());
    process.exit(1);
  }
  throw err;
}
