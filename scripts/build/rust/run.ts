/**
 * Build-time driver for one Rust unit. ninja runs
 *
 *   run.ts rustc        <unit.json>   compile, one edge (proc-macro, build script, staticlib)
 *   run.ts meta         <unit.json>   pipelined lib, first edge: start rustc, return once the .rmeta exists
 *   run.ts codegen      <unit.json>   pipelined lib, second edge: wait for that rustc, return its status (.rlib)
 *   run.ts build-script <unit.json>   run a compiled build script, record its `cargo:` directives
 *   run.ts monitor      <unit.json>   (internal, detached; started by `meta`) own the rustc process, log its stderr, record its exit
 *
 * `<unit.json>` is the `UnitManifest` configure wrote (units.ts): argv, env, cwd, outputs.
 *
 * ## Pipelining with one rustc process
 *
 * cargo starts a crate's dependents as soon as rustc has written the `.rmeta` (type information) while the same
 * process goes on to generate code for the `.rlib`; for a deep crate graph like bun's that roughly halves the
 * critical path. A ninja edge is done when its process exits, so the lib is two edges backed by one rustc: `meta`
 * starts a detached `monitor` that owns rustc, follows rustc's JSON diagnostics, and exits 0 the moment the
 * metadata artifact is announced — the `.rmeta` edge is complete and dependents start; rustc keeps running.
 * `codegen` (input: the `.rmeta`; output: the `.rlib`) attaches to the same state directory, replays diagnostics
 * emitted since, and exits with rustc's status once the monitor records it. An error before metadata fails `meta`
 * with the diagnostics and leaves nothing behind.
 *
 * The state directory `<rmeta>.state/` holds: `stderr` (rustc's JSON stream, appended by the monitor), `pid`
 * (`<rustc pid> <monitor pid>`), `handoff` (log offset `meta` had rendered up to), and `exit` (rustc's status,
 * written atomically by the monitor; absent while rustc runs).
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { availableParallelism, constants as osConstants } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { writeIfChanged } from "../fs.ts";
import { acquireJobserverToken, jobserverAvailable } from "../jobserver.ts";
import { processAlive, processCommandLine } from "../proc.ts";
import { type BuildScriptOutput, type RustcUnitManifest, type UnitManifest, envify } from "./units.ts";

const [mode, manifestPath] = process.argv.slice(2);
if (!mode || !manifestPath) {
  process.stderr.write("usage: run.ts rustc|meta|codegen|build-script|monitor <unit.json>\n");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as UnitManifest;

if (manifest.kind === "build-script-run") {
  if (mode !== "build-script") usage(`${manifest.crateName} is a build-script run; mode ${mode} does not apply`);
  runBuildScript(manifest);
} else if (mode === "rustc") {
  runRustc(manifest);
} else if (mode === "meta") {
  runMeta(manifest);
} else if (mode === "codegen") {
  runCodegen(manifest);
} else if (mode === "monitor") {
  runMonitor(manifest);
} else {
  usage(`unknown mode ${mode}`);
}

function usage(msg: string): never {
  process.stderr.write(`run.ts: ${msg}\n`);
  process.exit(2);
}

// ───────────────────────────────────────────────────────────────────────────
// Environment and argv
// ───────────────────────────────────────────────────────────────────────────

/**
 * The inherited environment with the manifest's variables applied (case-insensitively on Windows, where `Path` and
 * `PATH` are one variable) and the dynamic-library search path composed. cargo puts the host deps dir in front of
 * the inherited search path; that happens here, at build time, because the inherited part is the user's environment
 * and a manifest that captured it would rebuild every crate whenever PATH changed.
 */
function mergedEnv(unit: UnitManifest, ...layers: Record<string, string>[]): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const keyOf = (k: string) =>
    process.platform === "win32" ? (Object.keys(env).find(e => e.toUpperCase() === k.toUpperCase()) ?? k) : k;
  const set = (k: string, v: string) => {
    const existing = keyOf(k);
    if (existing !== k) delete env[existing];
    env[k] = v;
  };
  for (const layer of [unit.env, ...layers]) for (const [k, v] of Object.entries(layer)) set(k, v);
  const { variable, prepend } = unit.libraryPath;
  const inherited = (env[keyOf(variable)] ?? "").split(delimiter).filter(p => p.length > 0);
  // macOS: an unset DYLD_FALLBACK_LIBRARY_PATH means $HOME/lib:/usr/local/lib:/usr/lib; keep that meaning when prepending.
  if (inherited.length === 0 && variable === "DYLD_FALLBACK_LIBRARY_PATH") {
    inherited.push(join(process.env.HOME ?? "", "lib"), "/usr/local/lib", "/usr/lib");
  }
  set(variable, [...prepend, ...inherited].join(delimiter));
  return env;
}

function readScriptOutput(path: string): BuildScriptOutput {
  return JSON.parse(readFileSync(path, "utf8")) as BuildScriptOutput;
}

/**
 * rustc argv/env for the unit: the manifest's, plus what build scripts contributed. cargo add_native_deps adds `-L`
 * from the package's own script and from every dependency's, transitively (search paths are not recorded in rlibs,
 * so whoever links needs them all); add_custom_flags adds, from the own script only, `-l` (lib targets),
 * `-C link-arg`, `--cfg`, `--check-cfg` and the `rustc-env` pairs.
 */
function rustcInvocation(unit: RustcUnitManifest): { argv: string[]; env: Record<string, string> } {
  const args = [...unit.args];
  const own = unit.buildScriptOutput !== undefined ? readScriptOutput(unit.buildScriptOutput) : undefined;
  for (const s of own?.linkSearch ?? []) args.push("-L", s);
  for (const dep of unit.depBuildScriptOutputs) for (const s of readScriptOutput(dep).linkSearch) args.push("-L", s);
  if (own !== undefined) {
    if (unit.kind !== "build-script") for (const l of own.linkLibs) args.push("-l", l);
    for (const [selector, arg] of own.linkArgs) if (selector === "all") args.push("-C", `link-arg=${arg}`);
    for (const c of own.cfgs) args.push("--cfg", c);
    for (const c of own.checkCfgs) args.push("--check-cfg", c);
  }
  return { argv: args, env: mergedEnv(unit, Object.fromEntries(own?.env ?? [])) };
}

/**
 * The argv as given to the OS: inline, or as a rustc `@path` argument file (one argument per line) when the command
 * line would approach the platform's limit — 32K characters on Windows, where a deep build directory plus a hundred
 * absolute `--extern` paths gets there. cargo retries with an argfile on E2BIG; deciding up front is simpler.
 */
function spawnableArgv(unit: RustcUnitManifest, argv: string[]): string[] {
  const length = argv.reduce((n, a) => n + a.length + 3, 0);
  if (length < (process.platform === "win32" ? 24_000 : 512_000)) return argv;
  const argfile = `${unit.output}.args`;
  mkdirSync(dirname(argfile), { recursive: true });
  writeFileSync(argfile, argv.join("\n") + "\n");
  return [`@${argfile}`];
}

// ───────────────────────────────────────────────────────────────────────────
// dep-info → ninja depfile
// ───────────────────────────────────────────────────────────────────────────

/**
 * rustc's dep-info names every emitted artifact as a target (`x.rmeta: …`, `x.rlib: …`), adds a `file:` line per
 * source (like gcc -MP) and `# env-dep:` / `# checksum` comments. ninja wants the rule(s) for this edge's outputs
 * only, so keep those lines and the per-source phony lines. Paths are as rustc saw them — relative to its cwd for
 * workspace sources — while ninja reads depfile paths relative to the build directory, so everything is made
 * absolute. Spaces are `\ `-escaped on both sides (Makefile syntax).
 */
function writeDepfile(unit: RustcUnitManifest, forOutputs: string[]): void {
  if (!existsSync(unit.depInfo)) throw new Error(`rustc did not write ${unit.depInfo}`);
  const keep = new Set(forOutputs);
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(unit.cwd, p.replace(/\\ /g, " ")).replace(/ /g, "\\ "));
  const lines: string[] = [];
  for (const line of readFileSync(unit.depInfo, "utf8").split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    // `target: dep dep…` or a bare `target:`; split on ": " so a Windows drive letter (`C:\…`) stays whole.
    const m = /^(.*?): (.*)$/.exec(line) ?? /^(.*):\s*$/.exec(line);
    if (!m) continue;
    const target = abs(m[1]!);
    const deps = (m[2] ?? "").match(/(?:\\ |[^ ])+/g) ?? [];
    if (deps.length === 0) lines.push(`${target}:`);
    else if (keep.has(target.replace(/\\ /g, " "))) lines.push(`${target}: ${deps.map(abs).join(" ")}`);
  }
  writeFileSync(unit.depfile, lines.join("\n") + "\n");
}

// ───────────────────────────────────────────────────────────────────────────
// Outputs
// ───────────────────────────────────────────────────────────────────────────

/**
 * Give finished outputs the current time. Under `-C incremental` rustc hard-links an unchanged artifact (the `.rmeta`
 * in particular) out of the incremental cache, so it carries the mtime of the build that first produced it and ninja
 * would see every dependent as newer than it forever. cargo fingerprints contents and never notices.
 *
 * "Current time" is the filesystem's, read back from a file written now — not the process clock: the kernel stamps
 * files from a coarser clock that trails `Date.now()` by up to a few milliseconds, and a stamp taken from the process
 * clock can land *after* the mtime of an output a dependent writes moments later.
 */
function stampOutputs(paths: string[]): void {
  const existing = paths.filter(p => existsSync(p));
  if (existing.length === 0) return;
  const probe = `${existing[0]}.stamp`;
  writeFileSync(probe, "");
  const now = statSync(probe).mtime;
  rmSync(probe, { force: true });
  for (const p of existing) utimesSync(p, now, now);
}

/** Every file the unit's rustc writes that ninja knows of. */
function artifacts(unit: RustcUnitManifest): string[] {
  return unit.rmeta !== undefined ? [unit.rmeta, unit.output] : [unit.output];
}

function removeArtifacts(unit: RustcUnitManifest): void {
  for (const o of artifacts(unit)) {
    mkdirSync(dirname(o), { recursive: true });
    // cargo: rustc prefers an existing rlib over a newer rmeta of the same name when resolving `--extern x.rmeta`'s
    // transitive deps, and some linkers truncate hard-linked outputs in place — start from a clean slate.
    rmSync(o, { force: true });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// rustc, unpipelined
// ───────────────────────────────────────────────────────────────────────────

/** Run rustc to completion in this process's ninja slot, holding a jobserver token for its lifetime (jobserver.ts). */
function rustcSync(unit: RustcUnitManifest, argv: string[], env: Record<string, string>): number {
  const token = acquireJobserverToken();
  try {
    const r = spawnSync(unit.rustc, spawnableArgv(unit, argv), {
      cwd: unit.cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (r.error) throw r.error;
    return r.status ?? 128 + signalNumber(r.signal);
  } finally {
    token?.release();
  }
}

function signalNumber(signal: NodeJS.Signals | null): number {
  return signal === null ? 0 : (osConstants.signals[signal] ?? 0);
}

function runRustc(unit: RustcUnitManifest): never {
  removeArtifacts(unit);
  const { argv, env } = rustcInvocation(unit);
  const status = rustcSync(unit, argv, env);
  if (status === 0) {
    stampOutputs(artifacts(unit));
    writeDepfile(unit, artifacts(unit));
  }
  process.exit(status);
}

// ───────────────────────────────────────────────────────────────────────────
// rustc, pipelined: meta / monitor / codegen
// ───────────────────────────────────────────────────────────────────────────

interface PipelineState {
  dir: string;
  log: string;
  pid: string;
  handoff: string;
  exit: string;
}

function pipelineState(unit: RustcUnitManifest): PipelineState {
  if (unit.rmeta === undefined) usage(`${unit.crateName} is not a pipelined unit`);
  const dir = `${unit.rmeta}.state`;
  return {
    dir,
    log: join(dir, "stderr"),
    pid: join(dir, "pid"),
    handoff: join(dir, "handoff"),
    exit: join(dir, "exit"),
  };
}

/** `<rustc pid> <monitor pid>` as the monitor recorded them, or undefined. */
function recordedPids(state: PipelineState): { rustc: number; monitor: number } | undefined {
  if (!existsSync(state.pid)) return undefined;
  const [rustc, monitor] = readFileSync(state.pid, "utf8").split(" ").map(Number);
  return rustc! > 0 && monitor! > 0 ? { rustc: rustc!, monitor: monitor! } : undefined;
}

function recordedExit(state: PipelineState): number | undefined {
  return existsSync(state.exit) ? Number(readFileSync(state.exit, "utf8")) : undefined;
}

/**
 * Does `pid` name a live process working on *this* unit (its command line carries the unit's `-C metadata` hash /
 * manifest path)? A recorded pid with no recorded exit may have been recycled since (monitor killed outright,
 * machine reset).
 */
function isUnitProcess(unit: RustcUnitManifest, pid: number): boolean {
  if (!processAlive(pid)) return false;
  const cmdline = processCommandLine(pid);
  return [unit.args.find(a => a.startsWith("metadata=")) ?? unit.output, manifestPath!].some(n => cmdline.includes(n));
}

/**
 * A liveness watch on a process once identified as this unit's: `processAlive` per poll (cheap everywhere), the
 * command-line identity re-established every few seconds (it costs a subprocess on macOS/Windows) to catch a pid
 * reused after the process died.
 */
function unitProcessWatch(unit: RustcUnitManifest, pid: number): () => boolean {
  let verifiedAt = -Infinity;
  return () => {
    if (!processAlive(pid)) return false;
    if (Date.now() - verifiedAt < 5000) return true;
    if (!isUnitProcess(unit, pid)) return false;
    verifiedAt = Date.now();
    return true;
  };
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Poll `condition` every `intervalMs` until it holds or `timeoutMs` passed; returns whether it held. */
function waitFor(condition: () => boolean, timeoutMs: number, intervalMs = 20): boolean {
  for (const deadline = Date.now() + timeoutMs; ; ) {
    if (condition()) return true;
    if (Date.now() >= deadline) return false;
    sleepSync(intervalMs);
  }
}

/**
 * Stop whatever a previous build left running for this unit (a rustc past its metadata whose build was interrupted
 * without a driver to stop it) and wait for its monitor to be gone, so nothing can publish into the state this
 * invocation is about to recreate.
 */
function stopPrevious(unit: RustcUnitManifest, state: PipelineState): void {
  const pids = recordedPids(state);
  if (pids === undefined || recordedExit(state) !== undefined) return;
  if (isUnitProcess(unit, pids.rustc)) {
    try {
      process.kill(pids.rustc, "SIGTERM");
    } catch {}
  }
  waitFor(() => !isUnitProcess(unit, pids.monitor), 10_000);
}

/** Print rustc `--error-format=json` lines the way rustc would have; returns true if one announced the metadata artifact. */
function render(line: string): boolean {
  if (line.trim() === "") return false;
  let j: { $message_type?: string; artifact?: string; emit?: string; rendered?: string };
  try {
    j = JSON.parse(line);
  } catch {
    process.stderr.write(line + "\n"); // not JSON: an ICE banner, a `-Ztime-passes` line, …
    return false;
  }
  if (j.$message_type === "artifact" || j.artifact !== undefined) return j.emit === "metadata";
  if (j.$message_type === "future_incompat") return false;
  process.stderr.write(typeof j.rendered === "string" ? j.rendered : line + "\n");
  return false;
}

/** A reader over the monitor's log from `at`, feeding complete lines to `render`. */
class LogFollower {
  private buf = "";
  sawMetadata = false;
  constructor(
    private readonly path: string,
    public at = 0,
  ) {}
  /** Bytes rendered so far (excluding a trailing partial line). */
  get renderedUpTo(): number {
    return this.at - Buffer.byteLength(this.buf);
  }
  pump(): void {
    if (!existsSync(this.path)) return;
    const size = statSync(this.path).size;
    if (size <= this.at) return;
    const fd = openSync(this.path, "r");
    const b = Buffer.alloc(size - this.at);
    readSync(fd, b, 0, b.length, this.at);
    closeSync(fd);
    this.at = size;
    this.buf += b.toString("utf8");
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      if (render(this.buf.slice(0, nl))) this.sawMetadata = true;
      this.buf = this.buf.slice(nl + 1);
    }
  }
}

function runMeta(unit: RustcUnitManifest): void {
  const state = pipelineState(unit);
  // Without a jobserver nothing but ninja's -j bounds live rustc processes, and a pipelined rustc escapes that by
  // outliving this edge — so compile unpipelined: the .rmeta and .rlib both exist when this edge returns and the
  // codegen edge finds the recorded status immediately.
  if (!jobserverAvailable()) {
    stopPrevious(unit, state);
    rmSync(state.dir, { recursive: true, force: true });
    removeArtifacts(unit);
    const { argv, env } = rustcInvocation(unit);
    const args = argv.filter(a => !a.startsWith("--error-format=") && !a.startsWith("--json="));
    const status = rustcSync(unit, args, env);
    if (status !== 0) process.exit(status);
    stampOutputs(artifacts(unit));
    writeDepfile(unit, artifacts(unit));
    mkdirSync(state.dir, { recursive: true });
    writeFileSync(state.exit, "0");
    process.exit(0);
  }

  stopPrevious(unit, state);
  rmSync(state.dir, { recursive: true, force: true });
  mkdirSync(state.dir, { recursive: true });
  removeArtifacts(unit);
  writeFileSync(state.log, "");
  const monitor = spawn(process.execPath, [...process.execArgv, process.argv[1]!, "monitor", manifestPath!], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  if (monitor.pid === undefined) {
    process.stderr.write(`error: ${unit.crateName}: could not start the rustc monitor process\n`);
    process.exit(1);
  }
  monitor.unref();
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      const pids = recordedPids(state);
      if (pids !== undefined) {
        try {
          process.kill(pids.rustc, "SIGTERM");
        } catch {}
      }
      process.exit(128 + signalNumber(sig));
    });
  }
  const log = new LogFollower(state.log);
  const tick = () => {
    log.pump();
    if (log.sawMetadata) {
      stampOutputs([unit.rmeta!]);
      writeDepfile(unit, artifacts(unit)); // dep-info is emitted before metadata; the depfile belongs to this (first) edge
      writeFileSync(state.handoff, String(log.renderedUpTo));
      process.exit(0);
    }
    const code = recordedExit(state);
    if (code !== undefined) {
      // rustc finished without announcing metadata: an error before metadata (or, never observed, a clean exit).
      log.pump();
      if (code === 0) {
        stampOutputs(artifacts(unit));
        writeDepfile(unit, artifacts(unit));
        writeFileSync(state.handoff, String(log.at));
      }
      process.exit(code);
    }
    if (!processAlive(monitor.pid!)) {
      // The monitor publishes `exit` for every way rustc can end; if it is gone without having done so (killed
      // outright, out of disk while logging) nothing ever will.
      if (waitFor(() => recordedExit(state) !== undefined, 500)) return tick();
      log.pump();
      stopPrevious(unit, state);
      process.stderr.write(`error: ${unit.crateName}: the rustc monitor process died before reporting a result\n`);
      process.exit(1);
    }
    setTimeout(tick, 10);
  };
  tick();
}

/** The detached owner of a pipelined rustc: holds the jobserver token, logs stderr, publishes the exit status. */
function runMonitor(unit: RustcUnitManifest): void {
  const state = pipelineState(unit);
  const log = openSync(state.log, "a");
  const token = acquireJobserverToken(); // one token per live rustc (jobserver.ts); released in finish()
  const { argv, env } = rustcInvocation(unit);
  const child = spawn(unit.rustc, spawnableArgv(unit, argv), {
    cwd: unit.cwd,
    stdio: ["ignore", "inherit", "pipe"],
    env,
    windowsHide: true, // this process has no console (detached); without CREATE_NO_WINDOW Windows would open one for rustc
  });
  writeFileSync(state.pid, `${child.pid ?? 0} ${process.pid}`);
  child.stderr!.on("data", d => writeSync(log, d));
  let finished = false;
  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    token?.release();
    // A compilation that dies after handing off its .rmeta must not leave it looking finished: the next build has to
    // rerun the metadata step (dependents wait on it) rather than recompile underneath its readers.
    if (code !== 0) rmSync(unit.rmeta!, { force: true });
    if (existsSync(state.dir)) writeIfChanged(state.exit, String(code));
    process.exit(0);
  };
  // 'close', not 'exit': the status is published only once everything rustc wrote to stderr is in the log.
  child.on("close", (code, signal) => finish(code ?? 128 + signalNumber(signal)));
  child.on("error", e => {
    writeSync(log, String(e) + "\n");
    finish(127);
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => child.kill("SIGTERM"));
  // An interrupted build takes its compilations down with it, as cargo did. The build driver (scripts/build.ts)
  // exports its pid and, when it exits on its own — success or an unrelated failed edge — leaves a marker; a driver
  // that vanished without the marker was killed, and rustc is stopped. After an ordinary failure rustc is left to
  // finish, so the next build picks the result up instead of recompiling the crate and its dependents. (Watching
  // ninja through the meta step's ppid would not work: ninja runs commands via `sh -c`, and whether that shell execs
  // the command or stays as an intermediate parent differs between shells.)
  const driver = Number(process.env.BUN_BUILD_DRIVER_PID ?? "");
  const driverExitMarker = process.env.BUN_BUILD_DRIVER_EXIT_MARKER;
  if (driver > 0) {
    const watch = setInterval(() => {
      if (processAlive(driver)) return;
      clearInterval(watch);
      if (driverExitMarker === undefined || !existsSync(driverExitMarker)) child.kill("SIGTERM");
    }, 500);
    watch.unref();
  }
}

function runCodegen(unit: RustcUnitManifest): void {
  const state = pipelineState(unit);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(sig, () => process.exit(128 + signalNumber(sig)));
  /**
   * There is no code generation to wait for — no state (outputs restored from elsewhere, state wiped), the monitor
   * and rustc gone without a status (reboot, OOM killer), rustc killed by a signal (interrupted build) — so this
   * edge compiles the crate itself. That rewrites the `.rmeta` dependents may already have been released on; they
   * rebuild on the next run because its mtime moves.
   */
  const compileHere = (why: string): never => {
    process.stderr.write(`${unit.crateName}: ${why}; compiling it in this step\n`);
    rmSync(state.dir, { recursive: true, force: true });
    removeArtifacts(unit);
    const { argv, env } = rustcInvocation(unit);
    const args = argv.filter(a => !a.startsWith("--error-format=") && !a.startsWith("--json=")); // human diagnostics
    const status = rustcSync(unit, args, env);
    if (status === 0) stampOutputs(artifacts(unit));
    process.exit(status);
  };
  const finish = (code: number, log: LogFollower): never => {
    log.pump();
    if (code === 0) {
      stampOutputs([unit.output]);
      process.exit(0);
    }
    if (code > 128) compileHere(`rustc was killed (signal ${code - 128})`);
    // A real error after metadata (rare: codegen-time diagnostics). The .rmeta edge is what reruns rustc, so make it
    // dirty; otherwise ninja would consider it up to date and only retry this edge.
    process.stderr.write(`error: ${unit.crateName} failed during code generation (exit ${code})\n`);
    rmSync(unit.rmeta!, { force: true });
    rmSync(state.dir, { recursive: true, force: true });
    process.exit(1);
  };

  if (recordedExit(state) === undefined && recordedPids(state) === undefined)
    compileHere("no code generation in progress");
  const log = new LogFollower(state.log, existsSync(state.handoff) ? Number(readFileSync(state.handoff, "utf8")) : 0);
  const pids = recordedPids(state);
  const monitorAlive = pids === undefined ? () => false : unitProcessWatch(unit, pids.monitor);
  const tick = () => {
    log.pump();
    const code = recordedExit(state);
    if (code !== undefined) finish(code, log);
    // No status yet: the monitor must still be at work on this unit. If it is gone (and stays silent for a moment —
    // it publishes right after rustc's streams close), nobody will ever report.
    if (!monitorAlive()) {
      if (waitFor(() => recordedExit(state) !== undefined, 1000)) return tick();
      compileHere("the rustc process disappeared without an exit status");
    }
    setTimeout(tick, 20);
  };
  tick();
}

// ───────────────────────────────────────────────────────────────────────────
// build scripts (cargo custom_build::build_work + BuildOutput::parse)
// ───────────────────────────────────────────────────────────────────────────

/** Every regular file under `dir` (relative path → [content hash, mtime]). */
function snapshotDir(dir: string): Map<string, [string, Date]> {
  const out = new Map<string, [string, Date]>();
  const walk = (abs: string, rel: string): void => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const a = join(abs, e.name);
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(a, r);
      else if (e.isFile())
        out.set(r, [createHash("sha256").update(readFileSync(a)).digest("hex").slice(0, 16), statSync(a).mtime]);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out;
}

function runBuildScript(unit: Extract<UnitManifest, { kind: "build-script-run" }>): never {
  const { script } = unit;
  mkdirSync(script.outDir, { recursive: true });
  const before = snapshotDir(script.outDir);
  // NUM_JOBS is the machine's, decided now: putting it in the manifest would rerun every build script whenever
  // configure saw a different CPU count (cgroups, affinity). cargo does not fingerprint it either.
  const env = mergedEnv(unit, { NUM_JOBS: String(availableParallelism()) });
  delete env.RUSTFLAGS; // cargo: build scripts see CARGO_ENCODED_RUSTFLAGS, never RUSTFLAGS
  // DEP_<LINKS>_<KEY> from direct dependencies' scripts.
  for (const dep of script.linksDeps) {
    for (const [k, v] of readScriptOutput(dep.output).metadata) env[`DEP_${envify(dep.links)}_${envify(k)}`] = v;
  }
  const r = spawnSync(script.program, [], {
    cwd: unit.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 1 << 28,
    windowsHide: true,
  });
  if (r.error) throw r.error;
  const out = parseBuildScriptOutput(r.stdout);
  if (script.local)
    for (const w of out.warnings) process.stderr.write(`warning: ${unit.env.CARGO_PKG_NAME} build script: ${w}\n`);
  for (const e of out.errors) process.stderr.write(`error: ${unit.env.CARGO_PKG_NAME} build script: ${e}\n`);
  if (r.status !== 0 || out.errors.length > 0) {
    process.stderr.write(r.stdout);
    process.stderr.write(r.stderr);
    if (r.status !== 0)
      process.stderr.write(`error: build script for ${unit.env.CARGO_PKG_NAME} exited with ${r.status ?? r.signal}\n`);
    process.exit(1);
  }
  // Files the script regenerated with the same bytes keep their old mtime (crates `include!` them; a fresh mtime on
  // identical content would recompile the package and everything downstream one build later, when ninja next stats).
  const after = snapshotDir(script.outDir);
  for (const [rel, [hash, mtime]] of after) {
    const prev = before.get(rel);
    if (prev !== undefined && prev[0] === hash && prev[1].getTime() !== mtime.getTime())
      utimesSync(join(script.outDir, rel), prev[1], prev[1]);
  }
  out.outDirFiles = [...after]
    .map(([rel, [hash]]): [string, string] => [rel, hash])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Keep the raw streams next to the parsed result, as cargo does (useful when a script misbehaves).
  writeFileSync(join(dirname(unit.output), "stdout"), r.stdout);
  writeFileSync(join(dirname(unit.output), "stderr"), r.stderr);
  // Only if changed: the package's rustc edges and dependents' scripts depend on this file (restat).
  writeIfChanged(unit.output, JSON.stringify(out, null, 1) + "\n");
  // rerun-if-changed → the edge's depfile (paths relative to the manifest dir; a directory means anything beneath it, so
  // it is listed itself — its mtime moves when entries come or go — along with everything under it). Without any
  // rerun-if directive cargo reruns the script when any file of the package changes: for a local package that is the
  // package directory's contents; a registry or std package never changes.
  const roots =
    out.rerunIfChanged.length > 0 || out.rerunIfEnvChanged.length > 0
      ? out.rerunIfChanged.map(p => (isAbsolute(p) ? p : resolve(script.manifestDir, p)))
      : script.local
        ? [script.manifestDir]
        : [];
  const deps: string[] = [];
  const walk = (p: string): void => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return; // cargo: a missing rerun-if-changed path means "rerun when it appears" — nothing to watch yet
    }
    deps.push(p);
    if (st.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
  };
  for (const root of roots) walk(root);
  writeFileSync(unit.depfile, `${unit.output}: ${deps.map(d => d.replace(/ /g, "\\ ")).join(" ")}\n`);
  process.exit(0);
}

/**
 * cargo `BuildOutput::parse`. Lines are trimmed; `cargo::KEY=VALUE` is the current syntax (unknown keys are an
 * error there — reported as warnings here), `cargo:KEY=VALUE` the old one, under which unknown keys are metadata for
 * dependents (`cargo:root=…`, `cargo:include=…` from -sys crates) and `error` is not a directive.
 */
function parseBuildScriptOutput(stdout: string): BuildScriptOutput {
  const out: BuildScriptOutput = {
    linkLibs: [],
    linkSearch: [],
    linkArgs: [],
    cfgs: [],
    checkCfgs: [],
    env: [],
    metadata: [],
    rerunIfChanged: [],
    rerunIfEnvChanged: [],
    warnings: [],
    errors: [],
    outDirFiles: [],
  };
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    const newSyntax = line.startsWith("cargo::");
    if (!newSyntax && !line.startsWith("cargo:")) continue;
    const rest = line.slice(newSyntax ? "cargo::".length : "cargo:".length);
    const eq = rest.indexOf("=");
    if (eq < 0) {
      out.warnings.push(`invalid directive \`${line}\``);
      continue;
    }
    let key = rest.slice(0, eq);
    let value = rest.slice(eq + 1).trimEnd();
    if (newSyntax && key === "metadata") {
      const eq2 = value.indexOf("=");
      if (eq2 < 0) {
        out.warnings.push(`invalid metadata \`${line}\``);
        continue;
      }
      out.metadata.push([value.slice(0, eq2), value.slice(eq2 + 1)]);
      continue;
    }
    switch (key) {
      case "rustc-flags": {
        // `-l foo -L bar` only
        const toks = value.split(/\s+/).filter(t => t.length > 0);
        for (let i = 0; i < toks.length; i++) {
          const t = toks[i]!;
          if (t === "-l" || t === "-L") (t === "-l" ? out.linkLibs : out.linkSearch).push(toks[++i] ?? "");
          else if (t.startsWith("-l")) out.linkLibs.push(t.slice(2));
          else if (t.startsWith("-L")) out.linkSearch.push(t.slice(2));
          else out.warnings.push(`only -l and -L are allowed in rustc-flags: \`${line}\``);
        }
        break;
      }
      case "rustc-link-lib":
        out.linkLibs.push(value);
        break;
      case "rustc-link-search":
        out.linkSearch.push(value);
        break;
      case "rustc-link-arg":
        out.linkArgs.push(["all", value]);
        break;
      case "rustc-link-arg-bins":
        out.linkArgs.push(["bins", value]);
        break;
      case "rustc-link-arg-tests":
        out.linkArgs.push(["tests", value]);
        break;
      case "rustc-link-arg-benches":
        out.linkArgs.push(["benches", value]);
        break;
      case "rustc-link-arg-examples":
        out.linkArgs.push(["examples", value]);
        break;
      case "rustc-cdylib-link-arg":
      case "rustc-link-arg-cdylib":
        out.linkArgs.push(["cdylib", value]);
        break;
      case "rustc-cfg":
        out.cfgs.push(value);
        break;
      case "rustc-check-cfg":
        out.checkCfgs.push(value);
        break;
      case "rustc-env": {
        const eq2 = value.indexOf("=");
        if (eq2 < 0) {
          out.warnings.push(`invalid rustc-env \`${line}\``);
          break;
        }
        if (value.slice(0, eq2) === "RUSTC_BOOTSTRAP") {
          out.warnings.push("build script sets RUSTC_BOOTSTRAP; ignored");
          break;
        }
        out.env.push([value.slice(0, eq2), value.slice(eq2 + 1)]);
        break;
      }
      case "warning":
        out.warnings.push(value);
        break;
      case "rerun-if-changed":
        out.rerunIfChanged.push(value);
        break;
      case "rerun-if-env-changed":
        out.rerunIfEnvChanged.push(value);
        break;
      default:
        if (newSyntax && key === "error") out.errors.push(value);
        else if (key.startsWith("rustc-link-arg-bin=")) out.linkArgs.push([key.slice("rustc-link-arg-".length), value]);
        else if (!newSyntax) out.metadata.push([key, value]);
        else out.warnings.push(`unknown directive \`${line}\``);
    }
  }
  return out;
}
