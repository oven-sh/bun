/**
 * Build-time driver for one Rust unit. ninja runs
 *
 *   run.ts rustc        <unit.json>   compile, one edge (proc-macro, build script, staticlib)
 *   run.ts meta         <unit.json>   pipelined lib, first edge: start rustc, return once the .rmeta exists
 *   run.ts codegen      <unit.json>   pipelined lib, second edge: wait for that rustc, return its status (.rlib)
 *   run.ts build-script <unit.json>   run a compiled build script, record its `cargo:` directives
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
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { UnitManifest } from "./units.ts";

const [mode, manifestPath] = process.argv.slice(2);
if (!mode || !manifestPath) {
  process.stderr.write("usage: run.ts rustc|meta|codegen|build-script <unit.json>\n");
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
  /**
   * `OUT_DIR` after the run: relative path → content hash. Part of this file so that a script generating
   * *different* code changes output.json (defeating restat) and the package recompiles in the same build; files
   * regenerated with identical content get their previous mtime back and disturb nothing.
   */
  outDirFiles: [string, string][];
}

function scriptFlags(): { args: string[]; env: Record<string, string> } {
  if (unit.buildScriptOutput === undefined) return { args: [], env: {} };
  const out = JSON.parse(readFileSync(unit.buildScriptOutput, "utf8")) as BuildScriptOutput;
  const args: string[] = [];
  // cargo add_native_deps / add_custom_flags order: -L, -l (lib targets only), -C link-arg, --cfg, --check-cfg.
  for (const s of out.linkSearch) args.push("-L", s);
  if (unit.kind === "lib" || unit.kind === "staticlib" || unit.kind === "proc-macro")
    for (const l of out.linkLibs) args.push("-l", l);
  for (const [sel, arg] of out.linkArgs) if (sel === "all") args.push("-C", `link-arg=${arg}`);
  for (const c of out.cfgs) args.push("--cfg", c);
  for (const c of out.checkCfgs) args.push("--check-cfg", c);
  return { args, env: Object.fromEntries(out.env) };
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
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      if (process.platform === "win32")
        for (const existing of Object.keys(env))
          if (existing !== k && existing.toUpperCase() === k.toUpperCase()) delete env[existing];
      env[k] = v;
    }
  }
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
 */
function stampOutputs(paths: string[]): void {
  const now = new Date();
  for (const p of paths) if (existsSync(p)) utimesSync(p, now, now);
}

function prepareOutputs(): void {
  for (const o of [...unit.outputs, unit.rmeta].filter((o): o is string => o !== undefined)) {
    mkdirSync(dirname(o), { recursive: true });
    // cargo: rustc prefers an existing rlib over a newer rmeta of the same name when resolving `--extern x.rmeta`'s
    // transitive deps, and some linkers truncate hard-linked outputs in place — start from a clean slate.
    rmSync(o, { force: true });
  }
}

if (mode === "rustc") {
  prepareOutputs();
  const { argv, env } = rustcArgv();
  const r = spawnSync(rustc, argv, { cwd: unit.cwd, env, stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status === 0) {
    stampOutputs(unit.outputs);
    writeDepfile(unit.outputs);
  }
  process.exit(r.status ?? 1);
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

function killRecorded(): void {
  if (!existsSync(pidPath)) return;
  const pid = Number(readFileSync(pidPath, "utf8"));
  if (pid > 0) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
}

if (mode === "meta") {
  if (unit.rmeta === undefined) throw new Error(`run.ts meta: ${unit.crateName} is not a pipelined unit`);
  // A rustc from an interrupted build may still be running for this unit; it must not race the new one.
  if (existsSync(pidPath) && !existsSync(exitPath)) killRecorded();
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  prepareOutputs();
  const { argv, env } = rustcArgv();
  writeFileSync(logPath, "");
  // The monitor owns rustc so its exit status is observed even after this edge has returned. It is a few lines of
  // node given inline: append rustc's stderr to the log, then publish the exit code atomically.
  const monitor = `
    const { spawn } = require("node:child_process"); const fs = require("node:fs");
    const [logPath, exitPath, pidPath, rmetaPath, cwd, ninjaPid, rustc, ...argv] = process.argv.slice(1);
    const log = fs.openSync(logPath, "a");
    const child = spawn(rustc, argv, { cwd, stdio: ["ignore", "inherit", "pipe"], env: process.env });
    fs.writeFileSync(pidPath, String(child.pid));
    child.stderr.on("data", d => fs.writeSync(log, d));
    const done = code => {
      // A compilation that dies after handing off its .rmeta must not leave it looking finished: the next build
      // has to rerun the metadata step (dependents wait on it) rather than recompile underneath its readers.
      if (code !== 0) fs.rmSync(rmetaPath, { force: true });
      fs.writeFileSync(exitPath + ".tmp", String(code)); fs.renameSync(exitPath + ".tmp", exitPath); process.exit(0);
    };
    child.on("exit", (code, signal) => done(code ?? 128 + 15));
    child.on("error", e => { fs.writeSync(log, String(e) + "\\n"); done(127); });
    for (const s of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(s, () => child.kill("SIGTERM"));
    // An interrupted or failed build (ninja gone) takes its compilations down with it, as cargo does; the next
    // build's codegen step sees the signal status and recompiles.
    setInterval(() => { try { process.kill(Number(ninjaPid), 0); } catch { child.kill("SIGTERM"); } }, 500).unref();
  `;
  const child = spawn(
    process.execPath,
    ["-e", monitor, logPath, exitPath, pidPath, unit.rmeta, unit.cwd, String(process.ppid), rustc, ...argv],
    { detached: true, stdio: "ignore", env },
  );
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
    const r = spawnSync(rustc, args, { cwd: unit.cwd, env, stdio: "inherit" });
    if (r.status === 0) stampOutputs([unit.rmeta!, ...unit.outputs]);
    process.exit(r.status ?? 1);
  };
  if (!existsSync(stateDir) || !existsSync(pidPath)) compileHere("no code generation in progress");
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
    const pid = Number(readFileSync(pidPath, "utf8"));
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
} else if (mode === "build-script") {
  runBuildScript();
} else {
  process.stderr.write(`run.ts: unknown mode ${mode}\n`);
  process.exit(2);
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
  for (const w of out.warnings) process.stderr.write(`warning: ${unit.crateName} build script: ${w}\n`);
  if (r.status !== 0) {
    process.stderr.write(r.stdout);
    process.stderr.write(r.stderr);
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
        out.warnings.push(`error: ${value}`);
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
