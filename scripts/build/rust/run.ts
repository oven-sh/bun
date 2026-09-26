/**
 * Build-time driver for one Rust unit. ninja runs
 *
 *   run.ts rustc        <unit.json>   compile: a library, a proc-macro, a build script, a bin root
 *   run.ts build-script <unit.json>   run a compiled build script, record its `cargo:` directives
 *
 * `<unit.json>` is the `UnitManifest` configure wrote (units.ts): argv, env, cwd, outputs. This process lives
 * exactly as long as the rustc (or build script) it runs. What it adds around the command is what cargo does around
 * it: build-script-derived flags and environment, the dynamic-library search path, rustc's dep-info rewritten
 * into a ninja depfile, and output mtimes ninja can rely on.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { availableParallelism, constants as osConstants } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { BuildError } from "../error.ts";
import { writeIfChanged } from "../fs.ts";
import type { Phase } from "../timings.ts";
import { type BuildScriptOutput, envify } from "./cargo-env.ts";
import type { RustcUnitManifest, UnitManifest } from "./units.ts";

// Guarded so the tests can import the pieces below without running a unit.
if (process.argv[1] === import.meta.filename) {
  try {
    main();
  } catch (e) {
    if (!(e instanceof BuildError)) throw e;
    emit(2, e.format());
    process.exit(1);
  }
}

function main(): void {
  const [mode, manifestPath] = process.argv.slice(2);
  if (!mode || !manifestPath) usage("usage: run.ts rustc|build-script <unit.json>");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as UnitManifest;

  if (mode === "build-script" && manifest.kind === "build-script-run") runBuildScript(manifest);
  else if (mode === "rustc" && manifest.kind !== "build-script-run") runRustc(manifest);
  else usage(`mode ${mode} does not apply to ${manifest.crateName} (${manifest.kind})`);
}

/**
 * Write to this process's stdout (1) or stderr (2) synchronously. ninja reads both through one pipe, and this
 * process ends with process.exit(): a buffered stream (what process.stdout/stderr are for a pipe) can be cut off
 * by the exit, and two of them onto one pipe can interleave mid-line — which would hide an early-output
 * announcement from ninja. One blocking write per message keeps the order and loses nothing.
 */
function emit(fd: 1 | 2, text: string): void {
  const bytes = Buffer.from(text);
  for (let at = 0; at < bytes.length; ) {
    try {
      at += writeSync(fd, bytes, at);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EAGAIN") continue; // a pipe left non-blocking by someone else
      if ((e as NodeJS.ErrnoException).code === "EPIPE") return; // nobody is reading any more
      throw e;
    }
  }
}

function usage(msg: string): never {
  emit(2, `run.ts: ${msg}\n`);
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
export function rustcInvocation(unit: RustcUnitManifest): { argv: string[]; env: Record<string, string> } {
  const args = [...unit.args];
  const own = unit.buildScriptOutput !== undefined ? readScriptOutput(unit.buildScriptOutput) : undefined;
  for (const s of own?.linkSearch ?? []) args.push("-L", s);
  for (const dep of unit.depBuildScriptOutputs) for (const s of readScriptOutput(dep).linkSearch) args.push("-L", s);
  if (own !== undefined) {
    if (unit.kind !== "build-script") for (const l of own.linkLibs) args.push("-l", l);
    for (const [selector, arg] of own.linkArgs) {
      if (unit.linkArgSelectors.includes(selector)) args.push("-C", `link-arg=${arg}`);
    }
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
// rustc
// ───────────────────────────────────────────────────────────────────────────

function runRustc(unit: RustcUnitManifest): void {
  for (const o of [unit.output, unit.rmeta]) {
    if (o === undefined) continue;
    mkdirSync(dirname(o), { recursive: true });
    // cargo removes outputs first too: rustc prefers an existing rlib over a newer rmeta of the same name when
    // resolving a dependency, and some linkers truncate a hard-linked output in place.
    rmSync(o, { force: true });
  }
  const { argv, env } = rustcInvocation(unit);
  const exitStatus = (status: number | null, signal: NodeJS.Signals | null) =>
    status ?? 128 + (signal === null ? 0 : (osConstants.signals[signal] ?? 0));
  const finish = (status: number): never => {
    if (status === 0) {
      stampOutput(unit.output);
      // A ninja that was not told of the `.rmeta` early released it now, with the rest: same time as the output, so
      // that the timings do not read an early release that did not happen.
      if (unit.rmeta !== undefined && earlyOutputPrefix === undefined && existsSync(unit.rmeta)) {
        const { mtime } = statSync(unit.output);
        utimesSync(unit.rmeta, mtime, mtime);
      }
      // A bin is also wanted under its target's name, where its user looks for it (cargo "uplifts" it the same way).
      if (unit.binDestination !== undefined) {
        mkdirSync(dirname(unit.binDestination), { recursive: true });
        copyFileSync(unit.output, unit.binDestination);
        stampOutput(unit.binDestination);
      }
      writeDepfile(unit);
      if (unit.phases !== undefined) writeFileSync(unit.phases, JSON.stringify(phases) + "\n");
    }
    process.exit(status);
  };

  // rustc reports on stderr, as JSON lines, its diagnostics and the moment each artifact is written; only a library
  // writes a metadata artifact. A ninja that releases outputs early says so by exporting the edge's
  // `early_output_prefix`; any other ninja leaves the variable unset, and nothing is announced.
  const earlyOutputPrefix = process.env.NINJA_EARLY_OUTPUT_PREFIX || undefined;
  const phases: Phase[] = [];
  const child = spawn(unit.rustc, spawnableArgv(unit, argv), {
    cwd: unit.cwd,
    env,
    stdio: ["ignore", "inherit", "pipe"],
    windowsHide: true,
  });
  let pending = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      const pass = unit.phases === undefined ? undefined : timePass(line);
      if (pass !== undefined) {
        phases.push(pass);
        continue;
      }
      if (!renderRustcMessage(line) || unit.rmeta === undefined) continue;
      // The .rmeta is complete: give it a current mtime (see stampOutput) and tell ninja, which starts the
      // dependents now instead of when this process exits. Any other ninja gets it stamped with the output.
      if (earlyOutputPrefix === undefined) continue;
      stampOutput(unit.rmeta);
      emit(1, `${earlyOutputPrefix}${unit.rmetaNinjaName}\n`);
    }
  });
  child.on("error", e => {
    throw e;
  });
  // 'close', not 'exit': everything rustc wrote has been rendered by then.
  child.on("close", (status, signal) => {
    if (pending !== "") renderRustcMessage(pending);
    finish(exitStatus(status, signal));
  });
}

/**
 * A line of `-Z time-passes -Z time-passes-format=json`: `time: {"pass":…,"time":<seconds>,…}`, printed as the pass
 * ends. rustc gives the duration and no clock time, so the end is when the line arrived.
 */
export function timePass(line: string): Phase | undefined {
  if (!line.startsWith("time: {")) return undefined;
  const { pass, time } = JSON.parse(line.slice("time: ".length)) as { pass: string; time: number };
  const endMs = Date.now();
  return { name: pass, startMs: endMs - time * 1000, endMs };
}

/** Print one line of rustc's `--error-format=json` stream the way rustc would have; true if it announces the metadata artifact. */
function renderRustcMessage(line: string): boolean {
  if (line.trim() === "") return false;
  let message: { $message_type?: string; emit?: string; rendered?: string };
  try {
    message = JSON.parse(line);
  } catch {
    emit(2, line + "\n"); // not JSON: an ICE banner, a `-Z time-passes` line, …
    return false;
  }
  if (message.$message_type === "artifact") return message.emit === "metadata";
  if (message.$message_type === "future_incompat") return false;
  emit(2, typeof message.rendered === "string" ? message.rendered : line + "\n");
  return false;
}

/**
 * Give the finished output the current time. Under `-C incremental` rustc can hard-link an unchanged artifact out
 * of the incremental cache, so it carries the mtime of the build that first produced it and ninja would see the edge
 * as out of date forever. cargo fingerprints contents and never notices.
 *
 * "Current time" is the filesystem's, read back from a file written now — not the process clock: the kernel stamps
 * files from a coarser clock that trails `Date.now()` by up to a few milliseconds, and a stamp taken from the process
 * clock can land *after* the mtime of an output a dependent writes moments later.
 */
function stampOutput(path: string): void {
  if (!existsSync(path)) return;
  const probe = `${path}.stamp`;
  writeFileSync(probe, "");
  const now = statSync(probe).mtime;
  rmSync(probe, { force: true });
  utimesSync(path, now, now);
}

/**
 * rustc's dep-info names every emitted artifact as a target (`x.rlib: …`, `x.d: …`), adds a `file:` line per
 * source (like gcc -MP) and `# env-dep:` / `# checksum` comments. ninja wants the rule for this edge's output
 * only, so keep that line and the per-source phony lines. Paths are as rustc saw them — relative to its cwd for
 * workspace sources — while ninja reads depfile paths relative to the build directory, so everything is made
 * absolute. Spaces are `\ `-escaped on both sides (Makefile syntax).
 */
export function writeDepfile(unit: RustcUnitManifest): void {
  if (!existsSync(unit.depInfo)) throw new BuildError(`rustc did not write ${unit.depInfo}`);
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(unit.cwd, p.replace(/\\ /g, " ")).replace(/ /g, "\\ "));
  const lines: string[] = [];
  let sawRule = false;
  for (const line of readFileSync(unit.depInfo, "utf8").split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    // `target: dep dep…` or a bare `target:`; split on ": " so a Windows drive letter (`C:\…`) stays whole.
    const m = /^(.*?): (.*)$/.exec(line) ?? /^(.*):\s*$/.exec(line);
    if (!m) continue;
    const target = abs(m[1]!);
    const deps = (m[2] ?? "").match(/(?:\\ |[^ ])+/g) ?? [];
    if (deps.length === 0) lines.push(`${target}:`);
    else if (target.replace(/\\ /g, " ") === unit.output) {
      lines.push(`${target}: ${deps.map(abs).join(" ")}`);
      sawRule = true;
    }
  }
  // Without that rule ninja would record no dependencies at all and never rebuild the crate on a source edit.
  if (!sawRule) throw new BuildError(`${unit.depInfo} has no rule for ${unit.output}`);
  writeFileSync(unit.depfile, lines.join("\n") + "\n");
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
  if (script.local) for (const w of out.warnings) emit(2, `warning: ${unit.env.CARGO_PKG_NAME} build script: ${w}\n`);
  for (const e of out.errors) emit(2, `error: ${unit.env.CARGO_PKG_NAME} build script: ${e}\n`);
  if (r.status !== 0 || out.errors.length > 0) {
    emit(2, r.stdout);
    emit(2, r.stderr);
    if (r.status !== 0)
      emit(2, `error: build script for ${unit.env.CARGO_PKG_NAME} exited with ${r.status ?? r.signal}\n`);
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
    // A path that does not exist is listed too: cargo reruns the script on every build until it appears, and so
    // does ninja for a depfile input that is missing (output.json is restat'd, so nothing downstream rebuilds).
    deps.push(p);
    const st = statSync(p, { throwIfNoEntry: false });
    if (st?.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
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
export function parseBuildScriptOutput(stdout: string): BuildScriptOutput {
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
      case "rustc-link-arg-bin": {
        // `rustc-link-arg-bin=NAME=ARG`: for one binary target
        const eq2 = value.indexOf("=");
        if (eq2 < 0) {
          out.warnings.push(`invalid rustc-link-arg-bin \`${line}\``);
          break;
        }
        out.linkArgs.push([`bin=${value.slice(0, eq2)}`, value.slice(eq2 + 1)]);
        break;
      }
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
        else if (!newSyntax) out.metadata.push([key, value]);
        else out.warnings.push(`unknown directive \`${line}\``);
    }
  }
  return out;
}
