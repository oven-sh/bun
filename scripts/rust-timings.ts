#!/usr/bin/env bun
/**
 * Rust build-time profiler.
 *
 * Runs `cargo build --timings` with the exact args/rustflags/env the real
 * build uses (shared with `scripts/build/rust.ts::emitRust`), parses the
 * HTML report, and prints the critical path, slowest crates, and
 * low-parallelism windows so you can see where wall time actually goes.
 *
 * Usage:
 *   bun run rust:timings                 # incremental timing (warm cache)
 *   bun run rust:timings --clean         # clean-build timing into a scratch target dir
 *   bun run rust:timings --profile=release
 *   bun run rust:timings --report <path/to/cargo-timing.html>   # re-analyze an existing report
 *   bun run rust:timings --self-profile  # also emit per-crate rustc -Zself-profile traces
 *   bun run rust:timings --llvm-lines bun_runtime   # cargo-llvm-lines for one crate
 *
 * The raw `cargo-timing.html` is written under the target dir; open it in a
 * browser for the Gantt chart.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveConfig } from "./build/config.ts";
import { resolveToolchain } from "./build/configure.ts";
import { getProfile } from "./build/profiles.ts";
import { cargoBuildInvocation, cargoProfile } from "./build/rust.ts";

const repo = resolve(import.meta.dirname, "..");

interface Options {
  profile: string;
  clean: boolean;
  report: string | undefined;
  selfProfile: boolean;
  llvmLines: string | undefined;
  top: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    profile: "debug",
    clean: false,
    report: undefined,
    selfProfile: false,
    llvmLines: undefined,
    top: 20,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clean") opts.clean = true;
    else if (a === "--self-profile") opts.selfProfile = true;
    else if (a === "--report") opts.report = argv[++i];
    else if (a === "--llvm-lines") opts.llvmLines = argv[++i];
    else if (a === "--top") opts.top = parseInt(argv[++i], 10);
    else if (a.startsWith("--profile=")) opts.profile = a.slice("--profile=".length);
    else if (a === "--profile") opts.profile = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(readFileSync(import.meta.filename, "utf8").match(/\/\*\*[\s\S]*?\*\//)![0]);
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return opts;
}

// ─── cargo-timings HTML parsing ────────────────────────────────────────────

interface Section {
  start: number;
  end: number;
}
interface Unit {
  i: number;
  name: string;
  version: string;
  target: string;
  start: number;
  duration: number;
  /** Units unblocked when this unit's rlib is done. */
  unblocked_units: number[];
  /** Units unblocked when this unit's rmeta is done (pipelining). */
  unblocked_rmeta_units: number[];
  sections?: [string, Section][];
}

function parseTimingsHtml(path: string): { units: Unit[]; total: number } {
  const html = readFileSync(path, "utf8");
  const m = html.match(/const UNIT_DATA = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error(`no UNIT_DATA in ${path}`);
  const units: Unit[] = JSON.parse(m[1]);
  const total = Math.max(...units.map(u => u.start + u.duration));
  return { units, total };
}

/**
 * Time at which this unit unblocks downstream rmeta-dependents. For a
 * pipelined rlib that's when the frontend finishes (rmeta written), not
 * when codegen is done.
 */
function rmetaEnd(u: Unit): number {
  const fe = u.sections?.find(s => s[0] === "frontend");
  return u.start + (fe ? fe[1].end : u.duration);
}

function section(u: Unit, name: string): number {
  const s = u.sections?.find(x => x[0] === name);
  return s ? s[1].end - s[1].start : 0;
}

/**
 * Trace the critical path: walk backwards from the last unit, at each step
 * picking the dependency whose unblock time matches this unit's start. cargo
 * records `unblocked_units`/`unblocked_rmeta_units` on the *blocker*, so
 * inverting that map gives "who was I waiting on".
 */
function criticalPath(units: Unit[]): Unit[] {
  const byIdx = new Map(units.map(u => [u.i, u]));
  const waitsOn = new Map<number, { unit: Unit; at: number }[]>();
  for (const u of units) {
    for (const d of u.unblocked_units ?? []) {
      (waitsOn.get(d) ?? waitsOn.set(d, []).get(d)!).push({ unit: u, at: u.start + u.duration });
    }
    for (const d of u.unblocked_rmeta_units ?? []) {
      (waitsOn.get(d) ?? waitsOn.set(d, []).get(d)!).push({ unit: u, at: rmetaEnd(u) });
    }
  }
  let cur = units.reduce((a, b) => (a.start + a.duration > b.start + b.duration ? a : b));
  const path = [cur];
  while (true) {
    const blockers = waitsOn.get(cur.i) ?? [];
    // The immediate cause of `cur` starting is whichever blocker unblocked
    // latest (≤ cur.start, modulo cargo's scheduler jitter).
    const next = blockers.filter(b => b.at <= cur.start + 0.5).sort((a, b) => b.at - a.at)[0];
    if (!next || path.length > 80) break;
    path.push(next.unit);
    cur = next.unit;
  }
  return path.reverse();
}

/** Wall-clock windows where ≤ `maxActive` units are running for > `minDur` s. */
function serialWindows(units: Unit[], maxActive: number, minDur: number): [number, number, string[]][] {
  const events: [number, number][] = [];
  for (const u of units) {
    events.push([u.start, 1]);
    events.push([u.start + u.duration, -1]);
  }
  events.sort((a, b) => a[0] - b[0]);
  const out: [number, number, string[]][] = [];
  let active = 0;
  let since: number | null = null;
  for (const [t, d] of events) {
    const was = active;
    active += d;
    if (was > maxActive && active <= maxActive) since = t;
    if (was <= maxActive && active > maxActive && since !== null) {
      if (t - since > minDur) {
        const running = [...new Set(units.filter(u => u.start < t && u.start + u.duration > since!).map(u => u.name))];
        out.push([since, t, running]);
      }
      since = null;
    }
  }
  if (since !== null) {
    const end = Math.max(...units.map(u => u.start + u.duration));
    if (end - since > minDur) {
      const running = [...new Set(units.filter(u => u.start + u.duration > since!).map(u => u.name))];
      out.push([since, end, running]);
    }
  }
  return out;
}

function fmt(s: number): string {
  return s.toFixed(1).padStart(5) + "s";
}

function report(htmlPath: string, top: number): void {
  const { units, total } = parseTimingsHtml(htmlPath);
  const cpuSecs = units.reduce((s, u) => s + u.duration, 0);

  console.log(`\n${dim("report:")} ${htmlPath}`);
  if (total < 0.1) {
    console.log(
      `${bold("total")}  ${fmt(total)}  ${dim(`(all ${units.length} units fresh; run with --clean for a cold baseline)`)}\n`,
    );
    return;
  }
  console.log(
    `${bold("total")}  ${fmt(total)} wall   ${cpuSecs.toFixed(0)} unit-s   ` +
      `${(cpuSecs / total).toFixed(1)}× avg parallelism   ${units.length} units\n`,
  );

  console.log(bold(`slowest ${top} units`));
  const byDur = [...units].sort((a, b) => b.duration - a.duration).slice(0, top);
  for (const u of byDur) {
    const fe = section(u, "frontend");
    const cg = section(u, "codegen");
    const suffix = u.target && u.target !== "lib" ? ` ${dim(u.target)}` : "";
    const split = cg > 0 ? `  ${dim(`fe=${fe.toFixed(1)}s cg=${cg.toFixed(1)}s`)}` : "";
    console.log(`  ${fmt(u.duration)}  ${u.name}${suffix}${split}`);
  }

  console.log(`\n${bold("critical path")}  ${dim("(last-blocker chain to final unit)")}`);
  const path = criticalPath(units);
  let sum = 0;
  for (const u of path) {
    const fe = u.sections?.find(s => s[0] === "frontend");
    const unblocks = u.unblocked_rmeta_units.length > 0 && fe ? fe[1].end : u.duration;
    sum += unblocks;
    console.log(
      `  ${fmt(u.start)} → ${fmt(u.start + u.duration)}  ${u.name.padEnd(24)}` +
        `  ${dim(`blocks next for ${unblocks.toFixed(1)}s`)}`,
    );
  }
  console.log(`  ${dim(`critical-path sum: ${sum.toFixed(1)}s`)}`);

  const serial = serialWindows(units, 2, 1.0);
  if (serial.length > 0) {
    console.log(`\n${bold("low-parallelism windows")}  ${dim("(≤2 units active for >1s)")}`);
    for (const [s, e, names] of serial) {
      console.log(`  ${fmt(s)} – ${fmt(e)}  (${(e - s).toFixed(1)}s)  ${names.slice(0, 4).join(", ")}`);
    }
  }
  console.log();
}

// ─── terminal helpers ──────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const bold = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const cyan = (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s);

// ─── main ──────────────────────────────────────────────────────────────────

const opts = parseArgs(process.argv.slice(2));

if (opts.report !== undefined) {
  report(opts.report, opts.top);
  process.exit(0);
}

const toolchain = resolveToolchain();
const cfg = resolveConfig(getProfile(opts.profile), toolchain);
if (cfg.cargo === undefined) {
  console.error("cargo not found (resolveToolchain)");
  process.exit(1);
}

// Codegen + vendored path deps must exist before cargo can load the workspace
// manifest. The configure step is a no-op when already done.
if (!existsSync(cfg.codegenDir) || !existsSync(join(repo, "vendor/lolhtml/Cargo.toml"))) {
  console.log(cyan("[setup]") + " bun scripts/build.ts --configure-only --profile=" + opts.profile);
  const r = spawnSync(process.execPath, ["scripts/build.ts", "--configure-only", `--profile=${opts.profile}`], {
    stdio: "inherit",
    cwd: repo,
  });
  if (r.status !== 0) process.exit(1);
  spawnSync("ninja", ["-C", cfg.buildDir, "codegen", "clone-lolhtml"], { stdio: "inherit", cwd: repo });
}

const inv = cargoBuildInvocation(cfg);

// `--llvm-lines <crate>`: delegate to cargo-llvm-lines with our rustflags.
// Forces codegen-units=1 and emits LLVM IR, so it's a separate build; point it
// at a scratch target dir so it doesn't poison incremental state.
if (opts.llvmLines !== undefined) {
  const llDir = join(cfg.buildDir, "rust-llvm-lines");
  const llArgs = [
    "llvm-lines",
    "-p",
    opts.llvmLines,
    "--target",
    inv.triple,
    "--target-dir",
    llDir,
    "--profile",
    cargoProfile(cfg).name,
  ];
  console.log(cyan("[llvm-lines]") + ` cargo ${llArgs.join(" ")}`);
  const r = spawnSync(cfg.cargo, llArgs, {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, ...inv.env },
  });
  process.exit(r.status ?? 1);
}

// `--clean`: profile a from-scratch build into a throwaway target dir so the
// real one keeps its incremental cache.
let targetDir = inv.targetDir;
let args = inv.args;
if (opts.clean) {
  targetDir = join(cfg.buildDir, "rust-timings");
  console.log(cyan("[clean]") + ` removing ${targetDir}`);
  rmSync(targetDir, { recursive: true, force: true });
  args = args.map(a => (a === inv.targetDir ? targetDir : a));
}

// `--self-profile`: also write per-crate rustc self-profile traces. Summarize
// with `cargo install --locked measureme-cli && summarize <dir>/<crate>-*`.
const env = { ...process.env, ...inv.env };
if (opts.selfProfile) {
  const spDir = join(targetDir, "self-profile");
  rmSync(spDir, { recursive: true, force: true });
  const extra = `-Zself-profile=${spDir}\x1f-Zself-profile-events=default`;
  env.CARGO_ENCODED_RUSTFLAGS = env.CARGO_ENCODED_RUSTFLAGS ? `${env.CARGO_ENCODED_RUSTFLAGS}\x1f${extra}` : extra;
  console.log(cyan("[self-profile]") + ` rustc traces → ${spDir}`);
}

console.log(cyan("[cargo]") + ` build ${args.join(" ")} --timings`);
const r = spawnSync(cfg.cargo, ["build", ...args, "--timings"], {
  cwd: repo,
  stdio: "inherit",
  env,
});
if (r.status !== 0) process.exit(r.status ?? 1);

const htmlPath = join(targetDir, "cargo-timings", "cargo-timing.html");
if (!existsSync(htmlPath)) {
  console.error(`no timing report at ${htmlPath}`);
  process.exit(1);
}
report(htmlPath, opts.top);
