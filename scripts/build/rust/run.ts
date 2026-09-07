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
 * cargo starts a crate's dependents as soon as rustc has written the `.rmeta` (type information),
 * while the same process goes on to generate code for the `.rlib`; on this repository that is the
 * difference between an 83 s and a 128 s critical path. A ninja edge is done when its process
 * exits, so the lib is two edges backed by one rustc: `meta` spawns rustc under a small detached
 * monitor, follows rustc's JSON diagnostics, and exits 0 the moment the metadata artifact is
 * announced — the `.rmeta` edge is complete and dependents start; rustc keeps running. `codegen`
 * (inputs: the `.rmeta`; output: the `.rlib`) attaches to the same state directory, replays any
 * diagnostics emitted since, and exits with rustc's status once the monitor records it. An error
 * before metadata fails `meta` with the diagnostics and leaves nothing behind; rerunning `meta`
 * first stops a still-running rustc from a previous, interrupted build.
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
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { constants as osConstants } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { acquireJobserverToken, type JobserverToken } from "../jobserver.ts";
import type { UnitManifest } from "./units.ts";

const [mode, manifestPath] = process.argv.slice(2);
if (!mode || !manifestPath) {
  process.stderr.write("usage: run.ts rustc|meta|codegen|build-script|monitor <unit.json>\n");
  process.exit(2);
}
const unit = JSON.parse(readFileSync(manifestPath, "utf8")) as UnitManifest;
const rustc = unit.rustc;

// ───────────────────────────────────────────────────────────────────────────
// Build-script directives → rustc flags/env for the package's own units
// ───────────────────────────────────────────────────────────────────────────

/** What `build-script` writes to `output.json` (cargo: `BuildOutput`). */
interface BuildScriptOutput {
  /** `rustc-link-lib` → `-l` on the package's lib */
  linkLibs: string[];
  /** `rustc-link-search` → `-L` on the package's units and every dependent (transitively) */
  linkSearch: string[];
  /** `rustc-link-arg*` → `-C link-arg=` (kept with their target selector) */
  linkArgs: [selector: string, arg: string][];
  cfgs: string[];
  checkCfgs: string[];
  env: [string, string][];
  /** `metadata=K=V` / `cargo:K=V` → `DEP_<LINKS>_<K>` in dependents' build scripts */
  metadata: [string, string][];
  rerunIfChanged: string[];
  rerunIfEnvChanged: string[];
  warnings: string[];
  /** `cargo::error=` — the script reports failure this way even when it exits 0. */
  errors: string[];
  /**
   * `OUT_DIR` after the run: relative path → content hash. Part of this file so that a script generating
   * *different* code changes output.json (defeating restat) and the package recompiles in the same build; files
   * regenerated with identical content get their previous mtime back and disturb nothing.
   */
  outDirFiles: [string, string][];
}

function scriptFlags(): { args: string[]; env: Record<string, string> } {
  const args: string[] = [];
  const readOutput = (path: string) => JSON.parse(readFileSync(path, "utf8")) as BuildScriptOutput;
  // cargo add_native_deps: `-L` from the package's own build script and from every dependency's, transitively
  // (search paths are not recorded in rlibs, so whoever links needs them all); then, from the own script only
  // (add_custom_flags): `-l` (lib targets), `-C link-arg`, `--cfg`, `--check-cfg`, env.
  const own = unit.buildScriptOutput !== undefined ? readOutput(unit.buildScriptOutput) : undefined;
  for (const s of own?.linkSearch ?? []) args.push("-L", s);
  for (const dep of unit.depBuildScriptOutputs) for (const s of readOutput(dep).linkSearch) args.push("-L", s);
  if (own === undefined) return { args, env: {} };
  if (unit.kind === "lib" || unit.kind === "staticlib" || unit.kind === "proc-macro")
    for (const l of own.linkLibs) args.push("-l", l);
  for (const [sel, arg] of own.linkArgs) if (sel === "all") args.push("-C", `link-arg=${arg}`);
  for (const c of own.cfgs) args.push("--cfg", c);
  for (const c of own.checkCfgs) args.push("--check-cfg", c);
  return { args, env: Object.fromEntries(own.env) };
}

// ───────────────────────────────────────────────────────────────────────────
// dep-info → ninja depfile
// ───────────────────────────────────────────────────────────────────────────

/**
 * rustc's dep-info names every emitted artifact as a target (`x.rmeta: …`, `x.rlib: …`), adds a
 * `file:` line per source (like gcc -MP) and `# env-dep:` / `# checksum` comments. ninja wants the
 * rule(s) for this edge's outputs only, so keep those lines and the per-source phony lines.
 */
function writeDepfile(forOutputs: string[]): void {
  if (unit.depInfo === undefined || unit.depfile === undefined) return;
  if (!existsSync(unit.depInfo)) throw new Error(`rustc did not write ${unit.depInfo}`);
  const keep = new Set(forOutputs);
  // Paths are as rustc saw them: relative to its cwd for workspace sources. ninja reads depfile paths relative
  // to the build directory, so make everything absolute. Spaces are `\ `-escaped on both sides (Makefile syntax).
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(unit.cwd, p.replace(/\\ /g, " ")).replace(/ /g, "\\ "));
  const lines: string[] = [];
  for (const line of readFileSync(unit.depInfo, "utf8").split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    // `target: dep dep…` or a bare `target:`; split on ": " so a Windows drive letter (`C:\…`) stays whole.
    const m = /^(.*?): (.*)$/.exec(line) ?? /^(.*):\s*$/.exec(line);
    if (!m) continue;
    const target = abs(m[1]!);
    const deps = (m[2] ?? "").match(/(?:\\ |[^ ])+/g) ?? [];
    if (deps.length === 0)
      lines.push(`${target}:`); // per-source phony rule (like gcc -MP): keeps ninja quiet when a source is deleted
    else if (keep.has(target.replace(/\\ /g, " "))) lines.push(`${target}: ${deps.map(abs).join(" ")}`);
  }
  writeFileSync(unit.depfile, lines.join("\n") + "\n");
}

// ───────────────────────────────────────────────────────────────────────────
// JSON diagnostics (pipelined units)
// ───────────────────────────────────────────────────────────────────────────

/** Print a rustc `--error-format=json` line the way rustc would have printed it; returns true if it announced the metadata artifact. */
function render(line: string): boolean {
  if (line.trim() === "") return false;
  let j: { $message_type?: string; artifact?: string; emit?: string; rendered?: string } | undefined;
  try {
    j = JSON.parse(line);
  } catch {
    process.stderr.write(line + "\n"); // not JSON: an ICE banner, a `-Ztime-passes` line, …
    return false;
  }
  if (j!.$message_type === "artifact" || j!.artifact !== undefined) return j!.emit === "metadata";
  if (j!.$message_type === "future_incompat") return false;
  if (typeof j!.rendered === "string") process.stderr.write(j!.rendered);
  else process.stderr.write(line + "\n");
  return false;
}

// ───────────────────────────────────────────────────────────────────────────
// modes
// ───────────────────────────────────────────────────────────────────────────

/** The inherited environment with the manifest's variables applied (case-insensitively on Windows, where `Path` and `PATH` are one variable). */
function mergedEnv(...layers: Record<string, string>[]): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const set = (k: string, v: string) => {
    if (process.platform === "win32")
      for (const existing of Object.keys(env))
        if (existing !== k && existing.toUpperCase() === k.toUpperCase()) delete env[existing];
    env[k] = v;
  };
  for (const layer of layers) for (const [k, v] of Object.entries(layer)) set(k, v);
  // The dynamic-library search path (cargo: host deps dir first, then the inherited value) is composed here, at
  // build time, rather than stored in the manifest: the inherited part is the user's environment, and a manifest
  // that captured it would rebuild every crate whenever PATH changed.
  const { variable, prepend } = unit.libraryPath;
  const existing =
    Object.entries(env).find(([k]) =>
      process.platform === "win32" ? k.toUpperCase() === variable.toUpperCase() : k === variable,
    )?.[1] ?? "";
  const inherited = existing.split(delimiter).filter(p => p.length > 0);
  // macOS: an unset DYLD_FALLBACK_LIBRARY_PATH means $HOME/lib:/usr/local/lib:/usr/lib; keep that meaning when prepending.
  if (inherited.length === 0 && variable === "DYLD_FALLBACK_LIBRARY_PATH")
    inherited.push(join(process.env.HOME ?? "", "lib"), "/usr/local/lib", "/usr/lib");
  set(variable, [...prepend, ...inherited].join(delimiter));
  return env;
}

function rustcArgv(): { argv: string[]; env: Record<string, string> } {
  const extra = scriptFlags();
  return { argv: [...unit.args, ...extra.args], env: mergedEnv(unit.env, extra.env) };
}

/**
 * Give finished outputs the current time. Under `-C incremental` rustc hard-links an unchanged artifact (the
 * `.rmeta` in particular) out of the incremental cache, so it carries the mtime of the build that first produced
 * it and ninja would see every dependent as newer than it forever. cargo fingerprints contents and never notices.
 *
 * "Current time" is the filesystem's, read back from a file written now — not the process clock: the kernel stamps
 * files from a coarser clock that trails `Date.now()` by up to a few milliseconds, and a stamp taken from the
 * process clock can land *after* the mtime of an output a dependent writes moments later, making that dependent
 * look out of date on the next run.
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

function prepareOutputs(): void {
  for (const o of [...unit.outputs, unit.rmeta].filter((o): o is string => o !== undefined)) {
    mkdirSync(dirname(o), { recursive: true });
    // cargo: rustc prefers an existing rlib over a newer rmeta of the same name when resolving `--extern x.rmeta`'s
    // transitive deps, and some linkers truncate hard-linked outputs in place — start from a clean slate.
    rmSync(o, { force: true });
  }
}

/** Run rustc to completion in this process's slot, holding a jobserver token for its lifetime (see jobserver.ts). */
function rustcSync(args: string[], env: Record<string, string>): number {
  const token = acquireJobserverToken();
  try {
    const r = spawnSync(rustc, args, { cwd: unit.cwd, env, stdio: "inherit" });
    if (r.error) throw r.error;
    return r.status ?? 128 + (osConstants.signals[r.signal as keyof typeof osConstants.signals] ?? 0);
  } finally {
    token?.release();
  }
}

if (mode === "rustc") {
  prepareOutputs();
  const { argv, env } = rustcArgv();
  const status = rustcSync(argv, env);
  if (status === 0) {
    stampOutputs(unit.outputs);
    writeDepfile(unit.outputs);
  }
  process.exit(status);
}

/** Per-unit scratch for the meta/codegen handshake, next to the outputs. */
const stateDir = unit.rmeta !== undefined ? `${unit.rmeta}.state` : "";
const logPath = join(stateDir, "stderr");
const exitPath = join(stateDir, "exit");
const pidPath = join(stateDir, "pid");
const handoffPath = join(stateDir, "handoff");

/** Read whatever the monitor appended to the log since `offset`; feed complete lines to `onLine`. */
function follow(offset: { at: number; buf: string }, onLine: (line: string) => void): void {
  if (!existsSync(logPath)) return;
  const size = statSync(logPath).size;
  if (size <= offset.at) return;
  const fd = openSync(logPath, "r");
  const b = Buffer.alloc(size - offset.at);
  readSync(fd, b, 0, b.length, offset.at);
  closeSync(fd);
  offset.at = size;
  offset.buf += b.toString("utf8");
  let nl: number;
  while ((nl = offset.buf.indexOf("\n")) >= 0) {
    onLine(offset.buf.slice(0, nl));
    offset.buf = offset.buf.slice(nl + 1);
  }
}

function recordedRustcPid(): number | undefined {
  if (!existsSync(pidPath)) return undefined;
  const pid = Number(readFileSync(pidPath, "utf8").split(" ")[0]);
  return pid > 0 ? pid : undefined;
}

/**
 * Stop the rustc a previous `meta` left running for this unit — after checking the pid still is that rustc: with
 * no exit status recorded (monitor killed outright, machine reset) the number may belong to something else by now.
 */
function killRecorded(): void {
  const pid = recordedRustcPid();
  if (pid === undefined || !isOurRustc(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

/** Does `pid` name a live rustc compiling this unit? (its command line mentions this crate's metadata hash) */
function isOurRustc(pid: number): boolean {
  const needle = unit.args.find(a => a.startsWith("metadata="));
  let cmdline = "";
  try {
    if (process.platform === "linux") cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    else if (process.platform === "win32")
      cmdline =
        spawnSync(
          "powershell",
          ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
          { encoding: "utf8" },
        ).stdout ?? "";
    else cmdline = spawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" }).stdout ?? "";
  } catch {
    return false;
  }
  return needle !== undefined && cmdline.includes(needle);
}

if (mode === "meta") {
  if (unit.rmeta === undefined) throw new Error(`run.ts meta: ${unit.crateName} is not a pipelined unit`);
  // A rustc from an interrupted build may still be running for this unit; it must not race the new one.
  if (existsSync(pidPath) && !existsSync(exitPath)) killRecorded();
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  prepareOutputs();
  writeFileSync(logPath, "");
  // One jobserver token per live rustc (jobserver.ts): taken here, before rustc exists, and handed to the monitor,
  // which returns it when rustc exits — this edge returning at metadata must not return the token.
  const token = acquireJobserverToken();
  // The monitor (`run.ts monitor`, detached) owns rustc so that its exit status is observed after this edge has
  // returned: it appends rustc's stderr to the log and publishes the exit code atomically.
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, "monitor", manifestPath], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, BUN_RUST_MONITOR_HOLDS_TOKEN: token !== undefined ? "1" : "" },
  });
  // The token's descriptor/handle is this process's; the monitor re-acquires nothing and instead returns one unit to
  // the pool on our behalf when rustc ends. Dropping our handle without releasing keeps the count right.
  void token;
  child.unref();
  const offset = { at: 0, buf: "" };
  let sawMetadata = false;
  const onSignal = () => {
    killRecorded();
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);
  const tick = () => {
    follow(offset, line => {
      if (render(line)) sawMetadata = true;
    });
    if (sawMetadata) {
      stampOutputs([unit.rmeta!]);
      // dep-info is emitted before metadata; the depfile belongs to this (first) edge.
      writeDepfile([unit.rmeta!, ...unit.outputs]);
      writeFileSync(handoffPath, String(offset.at - Buffer.byteLength(offset.buf)));
      process.exit(0);
    }
    if (existsSync(exitPath)) {
      // rustc finished without announcing metadata: an error (or a signal). Drain and report.
      follow(offset, line => void render(line));
      const code = Number(readFileSync(exitPath, "utf8"));
      if (code === 0) {
        // Cannot normally happen (metadata is always announced before exit); treat as success for both edges.
        stampOutputs([unit.rmeta!, ...unit.outputs]);
        writeDepfile([unit.rmeta!, ...unit.outputs]);
        writeFileSync(handoffPath, String(offset.at));
      }
      process.exit(code);
    }
    setTimeout(tick, 15);
  };
  tick();
} else if (mode === "codegen") {
  // The normal case: the rustc `meta` started is still running or has finished; wait for / read its status.
  // Everything else — no state (outputs restored from elsewhere, state dir wiped), the monitor gone without a
  // status (reboot, OOM killer), rustc killed by a signal (interrupted build) — means there is no code generation
  // to wait for, and this edge compiles the crate itself.
  const onSignal = () => {
    killRecorded();
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);
  const compileHere = (why: string): never => {
    process.stderr.write(`${unit.crateName}: ${why}; compiling it in this step\n`);
    rmSync(stateDir, { recursive: true, force: true });
    const { argv, env } = rustcArgv();
    // Human diagnostics for the inline run (the manifest asks for JSON, which only `meta` needs).
    const args = argv.filter(a => !a.startsWith("--error-format=") && !a.startsWith("--json="));
    for (const o of [...unit.outputs, unit.rmeta!]) rmSync(o, { force: true });
    const status = rustcSync(args, env);
    if (status === 0) stampOutputs([unit.rmeta!, ...unit.outputs]);
    process.exit(status);
  };
  if (!existsSync(stateDir) || (!existsSync(pidPath) && !existsSync(exitPath)))
    compileHere("no code generation in progress");
  const offset = { at: existsSync(handoffPath) ? Number(readFileSync(handoffPath, "utf8")) : 0, buf: "" };
  const finish = (): never => {
    follow(offset, line => void render(line));
    const code = Number(readFileSync(exitPath, "utf8"));
    if (code === 0) {
      stampOutputs(unit.outputs);
      process.exit(0);
    }
    if (code > 128) compileHere(`rustc was killed (signal ${code - 128})`);
    // A real error after metadata (rare: codegen/link-time diagnostics). The .rmeta edge is what reruns rustc, so
    // make it dirty; otherwise ninja would consider it up to date and only retry this edge.
    process.stderr.write(`error: ${unit.crateName} failed during code generation (exit ${code})\n`);
    rmSync(unit.rmeta!, { force: true });
    rmSync(stateDir, { recursive: true, force: true });
    process.exit(1);
  };
  const tick = () => {
    follow(offset, line => void render(line));
    if (existsSync(exitPath)) finish();
    const pid = recordedRustcPid() ?? -1;
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (!alive) {
      // rustc is gone: either the monitor is about to publish the status, or both died.
      setTimeout(
        () => (existsSync(exitPath) ? finish() : compileHere("the rustc process disappeared without an exit status")),
        300,
      );
      return;
    }
    setTimeout(tick, 25);
  };
  tick();
} else if (mode === "monitor") {
  runMonitor();
} else if (mode === "build-script") {
  runBuildScript();
} else {
  process.stderr.write(`run.ts: unknown mode ${mode}\n`);
  process.exit(2);
}

// ───────────────────────────────────────────────────────────────────────────
// monitor: the detached owner of a pipelined rustc (spawned by `meta`)
// ───────────────────────────────────────────────────────────────────────────

function runMonitor(): void {
  const holdsToken = process.env.BUN_RUST_MONITOR_HOLDS_TOKEN === "1";
  delete process.env.BUN_RUST_MONITOR_HOLDS_TOKEN;
  const { argv, env } = rustcArgv();
  const log = openSync(logPath, "a");
  const child = spawn(rustc, argv, { cwd: unit.cwd, stdio: ["ignore", "inherit", "pipe"], env });
  writeFileSync(pidPath, `${child.pid} ${process.pid}`);
  child.stderr!.on("data", d => writeSync(log, d));
  let finished = false;
  const done = (code: number) => {
    if (finished) return;
    finished = true;
    // A compilation that dies after handing off its .rmeta must not leave it looking finished: the next build has to
    // rerun the metadata step (dependents wait on it) rather than recompile underneath its readers.
    if (code !== 0) rmSync(unit.rmeta!, { force: true });
    writeFileSync(exitPath + ".tmp", String(code));
    renameSync(exitPath + ".tmp", exitPath);
    if (holdsToken) returnJobserverToken();
    process.exit(0);
  };
  child.on("exit", (code, signal) =>
    done(code ?? 128 + (osConstants.signals[signal as keyof typeof osConstants.signals] ?? 0)),
  );
  child.on("error", e => {
    writeSync(log, String(e) + "\n");
    done(127);
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => child.kill("SIGTERM"));
  // An interrupted or failed build takes its compilations down with it, as cargo does: watch the build driver
  // (scripts/build.ts exports its pid; it outlives ninja by moments either way) and stop rustc when it is gone. Not
  // ninja's pid via the meta step's ppid: ninja runs commands through `sh -c`, and whether that shell execs the
  // command or lingers as an intermediate parent differs between shells. With no driver (ninja run by hand) nothing
  // is watched; a leftover rustc finishes, or the next `meta` for the unit stops it.
  const driver = Number(process.env.BUN_BUILD_DRIVER_PID ?? "");
  if (driver > 0)
    setInterval(() => {
      try {
        process.kill(driver, 0);
      } catch {
        child.kill("SIGTERM");
      }
    }, 500).unref();
}

/** Put one token back into the pool the `meta` step took it from (the monitor never held a descriptor of its own). */
function returnJobserverToken(): void {
  const auth = /--jobserver-auth=(\S+)/.exec(process.env.CARGO_MAKEFLAGS ?? "")?.[1];
  if (auth === undefined) return;
  try {
    if (auth.startsWith("fifo:")) {
      const fd = openSync(auth.slice("fifo:".length), "r+");
      writeSync(fd, "|");
      closeSync(fd);
    } else if (process.platform === "win32" && process.versions.bun !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
      const k32 = dlopen("kernel32.dll", {
        OpenSemaphoreW: { args: [FFIType.u32, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
        ReleaseSemaphore: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
        CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
      });
      const h = k32.symbols.OpenSemaphoreW(0x00100000 | 0x0002, 0, ptr(Buffer.from(auth + "\0", "utf16le")));
      if (h) {
        k32.symbols.ReleaseSemaphore(h, 1, null);
        k32.symbols.CloseHandle(h);
      }
    }
  } catch {
    // pool gone (build over): nothing to return it to
  }
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

function runBuildScript(): void {
  const script = unit.script!;
  mkdirSync(script.outDir, { recursive: true });
  const before = snapshotDir(script.outDir);
  const env = mergedEnv(unit.env);
  delete env.RUSTFLAGS;
  // DEP_<LINKS>_<KEY> from direct dependencies' scripts.
  for (const dep of script.linksDeps) {
    const out = JSON.parse(readFileSync(dep.output, "utf8")) as BuildScriptOutput;
    for (const [k, v] of out.metadata) env[`DEP_${envify(dep.links)}_${envify(k)}`] = v;
  }
  const r = spawnSync(script.program, [], {
    cwd: unit.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (r.error) throw r.error;
  const out = parseBuildScriptOutput(r.stdout, script.rustVersion);
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
  writeFileSync(join(dirname(unit.outputs[0]!), "stdout"), r.stdout);
  writeFileSync(join(dirname(unit.outputs[0]!), "stderr"), r.stderr);
  // Only-if-changed: the package's rustc edges and dependents' scripts depend on this file; an identical rerun must not rebuild them.
  const json = JSON.stringify(out, null, 1) + "\n";
  const outPath = unit.outputs[0]!;
  if (!existsSync(outPath) || readFileSync(outPath, "utf8") !== json) {
    writeFileSync(outPath + ".tmp", json);
    renameSync(outPath + ".tmp", outPath);
  }
  // rerun-if-changed → the edge's depfile (paths relative to the manifest dir; a directory means anything beneath it,
  // so it is listed itself — its mtime moves when entries come or go — along with every file under it). Without any
  // rerun-if directive cargo reruns the script when any file of the package changes: for a local package that is the
  // package directory's contents; a registry or std package never changes.
  if (unit.depfile !== undefined) {
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
        return; // cargo: a missing rerun-if-changed path just means "rerun when it appears" — nothing to watch yet
      }
      deps.push(p);
      if (st.isDirectory()) for (const e of readdirSync(p)) if (e !== "target" && !e.startsWith(".")) walk(join(p, e));
    };
    for (const r of roots) walk(r);
    writeFileSync(unit.depfile, `${outPath}: ${deps.map(d => d.replace(/ /g, "\\ ")).join(" ")}\n`);
  }
  process.exit(0);
}

function envify(s: string): string {
  return s.toUpperCase().replace(/-/g, "_");
}

function parseBuildScriptOutput(stdout: string, rustVersion: string | null): BuildScriptOutput {
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
    const line = rawLine.replace(/\r$/, "");
    let key: string, value: string, newSyntax: boolean;
    if (line.startsWith("cargo::")) {
      newSyntax = true;
      const rest = line.slice("cargo::".length);
      const eq = rest.indexOf("=");
      if (eq < 0) {
        out.warnings.push(`invalid directive \`${line}\``);
        continue;
      }
      key = rest.slice(0, eq);
      value = rest.slice(eq + 1);
      if (key === "metadata") {
        const eq2 = value.indexOf("=");
        if (eq2 < 0) {
          out.warnings.push(`invalid metadata \`${line}\``);
          continue;
        }
        out.metadata.push([value.slice(0, eq2), value.slice(eq2 + 1)]);
        continue;
      }
    } else if (line.startsWith("cargo:")) {
      newSyntax = false;
      const rest = line.slice("cargo:".length);
      const eq = rest.indexOf("=");
      if (eq < 0) {
        out.warnings.push(`invalid directive \`${line}\``);
        continue;
      }
      key = rest.slice(0, eq);
      value = rest.slice(eq + 1);
    } else continue;
    void newSyntax;
    void rustVersion;
    switch (key) {
      case "rustc-flags": {
        // `-l foo -L bar` only
        const toks = value.trim().split(/\s+/);
        for (let i = 0; i < toks.length; i++) {
          const t = toks[i]!;
          if (t === "-l" || t === "-L") {
            (t === "-l" ? out.linkLibs : out.linkSearch).push(toks[++i]!);
          } else if (t.startsWith("-l")) out.linkLibs.push(t.slice(2));
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
        const eq = value.indexOf("=");
        if (eq < 0) {
          out.warnings.push(`invalid rustc-env \`${line}\``);
          break;
        }
        if (value.slice(0, eq) === "RUSTC_BOOTSTRAP") {
          out.warnings.push("build script sets RUSTC_BOOTSTRAP; ignored");
          break;
        }
        out.env.push([value.slice(0, eq), value.slice(eq + 1)]);
        break;
      }
      case "warning":
        out.warnings.push(value);
        break;
      case "error":
        out.errors.push(value);
        break;
      case "rerun-if-changed":
        out.rerunIfChanged.push(value);
        break;
      case "rerun-if-env-changed":
        out.rerunIfEnvChanged.push(value);
        break;
      default:
        if (key.startsWith("rustc-link-arg-bin")) out.linkArgs.push([key.slice("rustc-link-arg-".length), value]);
        // old syntax: unknown keys are metadata (`cargo:root=…`, `cargo:include=…` from *-sys crates)
        else if (!line.startsWith("cargo::")) out.metadata.push([key, value]);
        else out.warnings.push(`unknown directive \`${line}\``);
    }
  }
  return out;
}
