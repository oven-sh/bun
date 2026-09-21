/**
 * Where a build's time went: `bun scripts/build.ts --timings`.
 *
 * Nothing is measured for this. Every build already records what the report needs:
 *
 *   .ninja_log    one line per output of every command ninja ran: when it started and ended on that ninja's clock,
 *                 and a file timestamp (see `LogEntry.stamp`) that places the command on the wall clock
 *   build.ninja   the graph: each edge's rule, pool, inputs and outputs
 *   the outputs   an edge that releases an output before it exits (`early_output_prefix`: a crate's `.rmeta`) stamps
 *                 that file then (rust/run.ts `stampOutput`), so its mtime says how far into the command its
 *                 dependents could start
 *
 * and, when the build was configured with `--time-trace=on`, what each compiler says about its own phases
 * (`SelfReport`).
 *
 * The report describes the build directory, not one invocation: for every edge, the last time it ran. That is the
 * same whether the directory was built a moment ago, yesterday, or in several sittings, and it is all ninja keeps in
 * the long run (it compacts the log down to one entry per output). What only exists within one run of ninja (how many
 * edges ran at once, how long an edge waited) is reported for the most recent run, the one run nothing can have
 * overwritten part of.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { BuildError } from "./error.ts";
import { type Manifest, type ManifestEdge, readManifest } from "./ninja.ts";
import { type RustcPhases, rustcPhasesPath } from "./rust/units.ts";
import { formatElapsed } from "./tty.ts";

// ───────────────────────────────────────────────────────────────────────────
// .ninja_log
// ───────────────────────────────────────────────────────────────────────────

export interface LogEntry {
  /** Milliseconds since the ninja process that ran the command started. */
  start: number;
  end: number;
  /**
   * ninja's `TimeStamp` of a file (src/build.cc `Builder::FinishCommand`): of `.ninja_lock`, which ninja touches as it
   * starts the command, or, for a `restat` or `generator` rule whose command changed its output, of the newest output.
   * So it is the command's start on the filesystem's clock, or a moment between its start and its end.
   */
  stamp: bigint;
  output: string;
}

/** The one format the ninja this build runs reads and writes (src/build_log.cc `kCurrentVersion`). */
const logSignature = "# ninja log v7";

export function parseNinjaLog(text: string): LogEntry[] {
  const lines = text.split("\n");
  if (lines[0] !== logSignature) {
    throw new BuildError(`.ninja_log starts with ${JSON.stringify(lines[0])}, not "${logSignature}"`, {
      hint: "The log was written by another ninja than the one this build runs. The next build rewrites it.",
    });
  }
  const entries: LogEntry[] = [];
  for (const line of lines.slice(1)) {
    const [start, end, stamp, output] = line.split("\t");
    if (output === undefined) continue; // the empty line after the last newline, or a line cut short by a kill
    entries.push({ start: Number(start), end: Number(end), stamp: BigInt(stamp!), output });
  }
  return entries;
}

/**
 * A `TimeStamp` as Unix milliseconds. POSIX: nanoseconds since 1970. Windows (src/disk_interface.cc
 * `TimeStampFromFileTime`): 100 ns ticks since 2001-01-01, the FILETIME epoch moved forward 400 years.
 */
function stampToUnixMs(stamp: bigint, windowsHost: boolean): number {
  return windowsHost ? Number(stamp / 10_000n) + Date.UTC(2001, 0, 1) : Number(stamp / 1_000_000n);
}

/**
 * How far `stamp - start` of a command can be from its ninja's start when the stamp is the command's start. Below:
 * the kernel stamps files from a clock it advances once per timer tick (10 ms at the slowest common rate, HZ=100).
 * Above: ninja reads its clock, creates the outputs' directories, and only then touches `.ninja_lock`.
 */
const STAMP_SLACK_MS = 10;

// ───────────────────────────────────────────────────────────────────────────
// Executions and runs
// ───────────────────────────────────────────────────────────────────────────

/** One time ninja ran one edge's command. */
export interface Execution {
  edge: ManifestEdge;
  /** What ninja printed for it: the rule's description with this edge's variables. */
  label: string;
  pool: string | undefined;
  /** On its run's clock. */
  start: number;
  end: number;
  stampMs: number;
  /** `stampMs` is the command's start (see `LogEntry.stamp`). */
  stampIsStart: boolean;
  run: Run;
  /**
   * Outputs released before the command ended, by absolute path: milliseconds after `start`. Known only for an
   * edge's last execution, whose files are the ones on disk.
   */
  released: Map<string, number>;
  selfReport: Phase[];
}

/** One ninja process that ran at least one command. */
export interface Run {
  /** Unix milliseconds of the ninja process's start: what `start` and `end` of its executions count from. */
  epochMs: number;
  executions: Execution[];
}

export const duration = (x: Execution): number => x.end - x.start;

/** The checkout these scripts are in, which is the one they build. */
const repoRoot = resolve(import.meta.dirname, "..", "..");

/**
 * A rule's description with `$out`, `$in` and the edge's own variables expanded, as ninja prints it, with paths into
 * the build directory and the checkout shortened to how the graph and the repository name them.
 */
function describe(buildDir: string, manifest: Manifest, edge: ManifestEdge): string {
  const text = manifest.rules.get(edge.rule)?.description ?? `${edge.rule} $out`;
  return text
    .replace(/\$(\$|\{[a-zA-Z0-9_.-]+\}|[a-zA-Z0-9_-]+)/g, (_, ref: string) => {
      if (ref === "$") return "$";
      const name = ref.startsWith("{") ? ref.slice(1, -1) : ref;
      if (name === "out") return edge.outputs.join(" ");
      if (name === "in") return edge.inputs.join(" ");
      return edge.bindings[name] ?? "";
    })
    .replaceAll(buildDir + sep, "")
    .replaceAll(repoRoot + sep, "")
    .replaceAll(repoRoot, ".")
    .trim();
}

/**
 * Split executions into the ninja processes that ran them. The log does not say: every ninja counts from its own
 * zero, and ninja rewrites the log in no particular order when it compacts it. What places an execution is its
 * stamp. When the stamp is the command's start, `stamp - start` is when its ninja started (the run's epoch), give or
 * take `STAMP_SLACK_MS`. Two ninjas on one build directory never overlap, so the next run's epoch is past every end of
 * this one: sorted by epoch, an execution belongs to the run before it exactly when its epoch falls before that run's
 * last end so far. When the stamp may be an output's mtime, all it says is that the epoch lies in
 * `[stamp - end, stamp - start]`; such an execution goes to the latest run whose epoch that allows, and the ones no
 * run allows (a ninja that only fetched, planned or reconfigured) are runs of their own.
 */
function groupRuns(executions: Omit<Execution, "run">[]): Run[] {
  type Open = Run & { latestEpochMs: number; lastEnd: number };
  const runs: Open[] = [];
  const add = (run: Open, x: Omit<Execution, "run">) => {
    run.lastEnd = Math.max(run.lastEnd, x.end);
    run.executions.push(Object.assign(x, { run }));
  };
  const epochOf = (x: Omit<Execution, "run">) => x.stampMs - x.start;
  const byEpoch = (a: Omit<Execution, "run">, b: Omit<Execution, "run">) => epochOf(a) - epochOf(b);

  for (const x of executions.filter(x => x.stampIsStart).sort(byEpoch)) {
    let run = runs.at(-1);
    if (run === undefined || epochOf(x) >= run.epochMs + run.lastEnd) {
      run = { epochMs: epochOf(x), latestEpochMs: epochOf(x), lastEnd: 0, executions: [] };
      runs.push(run);
    }
    run.latestEpochMs = epochOf(x);
    add(run, x);
  }

  const pinned = runs.length;
  for (const x of executions.filter(x => !x.stampIsStart).sort(byEpoch)) {
    const lo = x.stampMs - x.end - STAMP_SLACK_MS;
    const hi = epochOf(x) + STAMP_SLACK_MS;
    // Runs of commands that pin the epoch first; then the runs this loop started, the newest of which is the only
    // one still open to an execution in epoch order.
    let run = runs
      .slice(0, pinned)
      .filter(r => r.epochMs <= hi && r.latestEpochMs >= lo)
      .at(-1);
    if (run === undefined && runs.length > pinned && lo <= runs.at(-1)!.epochMs) run = runs.at(-1);
    if (run === undefined) {
      run = { epochMs: epochOf(x), latestEpochMs: epochOf(x), lastEnd: 0, executions: [] };
      runs.push(run);
    }
    add(run, x);
  }

  for (const run of runs) run.executions.sort((a, b) => a.start - b.start || a.end - b.end);
  return runs.sort((a, b) => a.epochMs - b.epochMs);
}

// ───────────────────────────────────────────────────────────────────────────
// What a compiler says about itself (--time-trace=on)
// ───────────────────────────────────────────────────────────────────────────

/** A stretch of one command's time, named by the compiler. Unix milliseconds. */
export interface Phase {
  name: string;
  startMs: number;
  endMs: number;
}

/** clang's `-ftime-trace` file: Chrome trace events, microseconds after `beginningOfTime` (Unix microseconds). */
interface ClangTimeTrace {
  beginningOfTime: number;
  traceEvents: { ph: string; name: string; ts: number; dur?: number; args?: { detail?: string } }[];
}

const clangRules = new Set(["cc", "cxx", "cxx_pch", "pch", "pch_msvc"]);

function readSelfReport(buildDir: string, edge: ManifestEdge): Phase[] {
  const output = resolve(buildDir, edge.outputs[0]!);
  if (clangRules.has(edge.rule)) {
    // clang names the trace after the output, with its extension replaced.
    const path = output.replace(/\.[^./\\]+$/, ".json");
    if (!existsSync(path)) return [];
    const trace = JSON.parse(readFileSync(path, "utf8")) as ClangTimeTrace;
    const phases: Phase[] = [];
    for (const e of trace.traceEvents) {
      // "Total <name>" events are clang's own sums, not stretches of time.
      if (e.ph !== "X" || e.dur === undefined || e.name.startsWith("Total ")) continue;
      const startMs = (trace.beginningOfTime + e.ts) / 1000;
      const detail = e.args?.detail;
      phases.push({
        name: detail ? `${e.name} ${detail}` : e.name,
        startMs,
        endMs: startMs + e.dur / 1000,
      });
    }
    return phases;
  }
  if (edge.rule === "rust_rustc") {
    const path = rustcPhasesPath(output);
    if (!existsSync(path)) return [];
    return (JSON.parse(readFileSync(path, "utf8")) as RustcPhases).phases;
  }
  return [];
}

/**
 * The phases that are whole parts of the command: inside nothing but the one phase that spans it all (clang's
 * `ExecuteCompiler`, rustc's `total`). Compilers report phases nested, and only by their times.
 */
export function topLevelPhases(phases: Phase[]): Phase[] {
  const root = phases.reduce<Phase | undefined>(
    (a, b) => (a === undefined || b.endMs - b.startMs > a.endMs - a.startMs ? b : a),
    undefined,
  );
  const inside = (p: Phase, q: Phase) => p !== q && q.startMs <= p.startMs && p.endMs <= q.endMs;
  return phases.filter(p => p !== root && !phases.some(q => q !== root && inside(p, q)));
}

// ───────────────────────────────────────────────────────────────────────────
// Loading a build directory
// ───────────────────────────────────────────────────────────────────────────

export interface Build {
  buildDir: string;
  manifest: Manifest;
  /** Oldest first. */
  runs: Run[];
  /** Each edge's last execution; an edge that is a phony, or that no build has run, has none. */
  last: Map<ManifestEdge, Execution>;
  /** The edge that makes each file (or phony name), by absolute path. */
  producer: Map<string, ManifestEdge>;
}

export function loadBuild(buildDir: string, windowsHost: boolean = process.platform === "win32"): Build {
  buildDir = resolve(buildDir);
  const manifestPath = resolve(buildDir, "build.ninja");
  const logPath = resolve(buildDir, ".ninja_log");
  if (!existsSync(manifestPath) || !existsSync(logPath)) {
    throw new BuildError(`${buildDir} has not been built`, { hint: "Timings describe a build that has run." });
  }
  const manifest = readManifest(readFileSync(manifestPath, "utf8"));
  const producer = new Map<string, ManifestEdge>();
  for (const edge of manifest.edges) {
    for (const out of [...edge.outputs, ...edge.implicitOutputs]) producer.set(resolve(buildDir, out), edge);
  }

  // An execution is logged once per output, with the same times on each line. Lines whose output no edge makes any
  // more are from a graph that is gone.
  const seen = new Map<string, Omit<Execution, "run">>();
  for (const entry of parseNinjaLog(readFileSync(logPath, "utf8"))) {
    const edge = producer.get(resolve(buildDir, entry.output));
    if (edge === undefined) continue;
    const key = `${manifest.edges.indexOf(edge)} ${entry.start} ${entry.end} ${entry.stamp}`;
    if (seen.has(key)) continue;
    const rule = manifest.rules.get(edge.rule);
    seen.set(key, {
      edge,
      label: describe(buildDir, manifest, edge),
      pool: edge.bindings.pool ?? rule?.pool,
      start: entry.start,
      end: entry.end,
      stampMs: stampToUnixMs(entry.stamp, windowsHost),
      // A restat or generator rule's stamp is its output's mtime when the command changed the output.
      stampIsStart: rule !== undefined && !rule.restat && !rule.generator,
      released: new Map(),
      selfReport: [],
    });
  }
  const runs = groupRuns([...seen.values()]);

  const last = new Map<ManifestEdge, Execution>();
  for (const run of runs) for (const x of run.executions) last.set(x.edge, x);
  for (const x of last.values()) {
    readReleased(buildDir, x);
    x.selfReport = readSelfReport(buildDir, x.edge).filter(
      // A report left by another execution than the logged one (a build that was interrupted) says nothing about it.
      p => p.startMs >= x.stampMs - STAMP_SLACK_MS && p.endMs <= x.run.epochMs + x.end + STAMP_SLACK_MS,
    );
  }
  return { buildDir, manifest, runs, last, producer };
}

/**
 * When an edge that announces outputs early released each one. Such a command stamps an output as it announces it
 * (rust/run.ts `stampOutput`), from the same clock the log's stamp of the command's start comes from.
 */
function readReleased(buildDir: string, x: Execution): void {
  if (x.edge.bindings.early_output_prefix === undefined || !x.stampIsStart) return;
  const after = x.edge.outputs.map(o => {
    const mtimeMs = statSync(resolve(buildDir, o), { throwIfNoEntry: false })?.mtimeMs;
    return mtimeMs === undefined ? undefined : Math.floor(mtimeMs) - x.stampMs;
  });
  // Files from another execution than the logged one (a build that was interrupted) say nothing about it.
  if (after.some(ms => ms === undefined || ms < -STAMP_SLACK_MS || ms > duration(x) + STAMP_SLACK_MS)) return;
  // The output stamped last is the one the command ended with, not an early one.
  const last = Math.max(...(after as number[]));
  x.edge.outputs.forEach((o, i) => {
    if (after[i]! < last) x.released.set(resolve(buildDir, o), Math.max(0, after[i]!));
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Analysis
// ───────────────────────────────────────────────────────────────────────────

export interface KindTotal {
  rule: string;
  edges: number;
  totalMs: number;
  slowest: Execution;
}

export function totalsByKind(build: Build): KindTotal[] {
  const kinds = new Map<string, KindTotal>();
  for (const x of build.last.values()) {
    const k = kinds.get(x.edge.rule);
    if (k === undefined) kinds.set(x.edge.rule, { rule: x.edge.rule, edges: 1, totalMs: duration(x), slowest: x });
    else {
      k.edges++;
      k.totalMs += duration(x);
      if (duration(x) > duration(k.slowest)) k.slowest = x;
    }
  }
  return [...kinds.values()].sort((a, b) => b.totalMs - a.totalMs);
}

export interface PathStep {
  execution: Execution;
  /** How long the next step waited on this one: its whole duration, or up to the output it released early. */
  blocksNextForMs: number;
}

/**
 * The chain of edges that bounds a build of everything: the longest path through the graph when each edge takes as
 * long as it last took and starts the moment its inputs exist. An input exists when its edge ends, or when its edge
 * released it (a library crate's dependents wait for its `.rmeta`, not for its code). Computed from the graph rather
 * than read off start times, so it is the same after one build of everything and after a hundred incremental ones,
 * and it is what is left when no edge waits for a free core.
 */
export function criticalPath(build: Build): { steps: PathStep[]; totalMs: number } {
  interface Timing {
    ready: number;
    /** The input's edge `ready` came from, and how long that edge held this one back. */
    via: { edge: ManifestEdge; blocksNextForMs: number } | undefined;
  }
  const timings = new Map<ManifestEdge, Timing>();
  const timing = (edge: ManifestEdge): Timing => {
    let t = timings.get(edge);
    if (t !== undefined) return t;
    t = { ready: 0, via: undefined };
    timings.set(edge, t);
    for (const input of [...edge.inputs, ...edge.implicitInputs, ...edge.orderOnlyInputs]) {
      const path = resolve(build.buildDir, input);
      const from = build.producer.get(path);
      if (from === undefined) continue; // a source file
      const x = build.last.get(from);
      const blocksNextForMs = x === undefined ? 0 : (x.released.get(path) ?? duration(x));
      const at = timing(from).ready + blocksNextForMs;
      if (at > t.ready) {
        t.ready = at;
        t.via = { edge: from, blocksNextForMs };
      }
    }
    return t;
  };

  let lastEdge: ManifestEdge | undefined;
  let totalMs = 0;
  for (const [edge, x] of build.last) {
    const end = timing(edge).ready + duration(x);
    if (end > totalMs) [lastEdge, totalMs] = [edge, end];
  }
  const steps: PathStep[] = [];
  for (let at = lastEdge, blocks = 0; at !== undefined; ) {
    const x = build.last.get(at);
    if (x !== undefined) steps.unshift({ execution: x, blocksNextForMs: steps.length === 0 ? duration(x) : blocks });
    const via = timing(at).via;
    blocks = via?.blocksNextForMs ?? 0;
    at = via?.edge;
  }
  return { steps, totalMs };
}

export interface LowParallelismWindow {
  from: number;
  to: number;
  running: Execution[];
}

/** A stretch counts as low parallelism at this many commands or fewer … */
const LOW_PARALLELISM_EDGES = 2;
/** … lasting at least this long. */
const LOW_PARALLELISM_MS = 1000;

export function lowParallelismWindows(run: Run): LowParallelismWindow[] {
  const events = run.executions.flatMap(x => [
    { at: x.start, change: 1 },
    { at: x.end, change: -1 },
  ]);
  events.sort((a, b) => a.at - b.at || a.change - b.change);
  const windows: LowParallelismWindow[] = [];
  const close = (from: number, to: number) => {
    if (to - from < LOW_PARALLELISM_MS) return;
    windows.push({ from, to, running: run.executions.filter(x => x.start < to && x.end > from) });
  };
  let running = 0;
  // The run starts with nothing running.
  let since: number | undefined = 0;
  for (const { at, change } of events) {
    const was = running;
    running += change;
    if (was > LOW_PARALLELISM_EDGES && running <= LOW_PARALLELISM_EDGES) since = at;
    if (was <= LOW_PARALLELISM_EDGES && running > LOW_PARALLELISM_EDGES && since !== undefined) {
      close(since, at);
      since = undefined;
    }
  }
  if (since !== undefined) close(since, Math.max(...run.executions.map(x => x.end)));
  return windows;
}

export interface QueueTotal {
  /** A pool's name; `undefined` for edges in no pool, which wait only for one of ninja's `-j` job slots. */
  pool: string | undefined;
  depth: number | undefined;
  edges: number;
  totalMs: number;
  longest: { execution: Execution; ms: number };
}

/** How long each of the run's edges waited to start after its inputs existed. */
export function waits(build: Build, run: Run): Map<Execution, number> {
  const inRun = new Map<ManifestEdge, Execution>(run.executions.map(x => [x.edge, x]));
  // When an edge's outputs existed in this run; an edge the run did not execute (up to date, or a phony) passes on
  // when its own inputs did.
  const readyAt = new Map<ManifestEdge, number>();
  const ready = (edge: ManifestEdge): number => {
    let at = readyAt.get(edge);
    if (at !== undefined) return at;
    at = 0;
    readyAt.set(edge, at);
    for (const input of [...edge.inputs, ...edge.implicitInputs, ...edge.orderOnlyInputs]) {
      const path = resolve(build.buildDir, input);
      const from = build.producer.get(path);
      if (from === undefined) continue;
      const x = inRun.get(from);
      at = Math.max(at, x === undefined ? ready(from) : x.start + (x.released.get(path) ?? duration(x)));
    }
    readyAt.set(edge, at);
    return at;
  };

  return new Map(run.executions.map(x => [x, Math.max(0, x.start - ready(x.edge))]));
}

/**
 * `waits`, by pool. The log does not say why an edge waited: an edge in a pool waits for the pool or for a job slot,
 * whichever is full.
 */
export function queueTimes(build: Build, run: Run): QueueTotal[] {
  const totals = new Map<string | undefined, QueueTotal>();
  for (const [x, ms] of waits(build, run)) {
    const t = totals.get(x.pool);
    if (t === undefined) {
      const depth = x.pool === "console" ? 1 : x.pool === undefined ? undefined : build.manifest.pools.get(x.pool);
      totals.set(x.pool, { pool: x.pool, depth, edges: 1, totalMs: ms, longest: { execution: x, ms } });
    } else {
      t.edges++;
      t.totalMs += ms;
      if (ms > t.longest.ms) t.longest = { execution: x, ms };
    }
  }
  return [...totals.values()].sort((a, b) => b.totalMs - a.totalMs);
}

// ───────────────────────────────────────────────────────────────────────────
// The report
// ───────────────────────────────────────────────────────────────────────────

const seconds = (ms: number): string => formatElapsed(ms).padStart(7);
export const clock = (unixMs: number): string => new Date(unixMs).toISOString().replace("T", " ").slice(0, 19) + "Z";

export interface ReportStyle {
  bold(s: string): string;
  dim(s: string): string;
}

const SLOWEST_EDGES = 20;
const EARLIER_RUNS_LISTED = 10;
/** A low-parallelism window names the longest of the commands that ran in it. */
const WINDOW_EDGES_NAMED = 4;
/** Compiler phases shown under an edge: the largest few say where its time went; the rest are in the trace. */
const PHASES_SHOWN = 4;

export function formatReport(build: Build, style: ReportStyle): string {
  const { bold, dim } = style;
  const out: string[] = [];
  const executions = [...build.last.values()];
  const neverBuilt = build.manifest.edges.filter(e => e.rule !== "phony" && !build.last.has(e)).length;
  const runsOfLast = new Set(executions.map(x => x.run));

  out.push(`${bold("build timings")}  ${relative(process.cwd(), build.buildDir) || "."}`);
  if (executions.length === 0) {
    out.push("  no edge of build.ninja is in the log yet");
    return out.join("\n") + "\n";
  }
  const stamps = executions.map(x => x.stampMs);
  out.push(
    `  ${executions.length} edges, last built by ${runsOfLast.size} ${runsOfLast.size === 1 ? "run" : "runs"} of ninja` +
      ` between ${clock(Math.min(...stamps))} and ${clock(Math.max(...stamps))}` +
      (neverBuilt > 0 ? dim(`  (${neverBuilt} more have not been built)`) : ""),
  );

  out.push(
    "",
    bold("by kind".padEnd(26)) + dim(`${"edges".padStart(7)}${"total".padStart(9)}  ${"slowest".padStart(7)}`),
  );
  for (const k of totalsByKind(build)) {
    out.push(
      `  ${k.rule.padEnd(24)}${String(k.edges).padStart(7)}${seconds(k.totalMs).padStart(9)}  ${seconds(duration(k.slowest))}  ${dim(k.slowest.label)}`,
    );
  }

  out.push("", bold(`slowest ${Math.min(SLOWEST_EDGES, executions.length)} edges`));
  for (const x of [...executions].sort((a, b) => duration(b) - duration(a)).slice(0, SLOWEST_EDGES)) {
    const early = [...x.released.values()];
    const note = early.length > 0 ? dim(`  dependents start after ${seconds(Math.min(...early)).trim()}`) : "";
    out.push(`  ${seconds(duration(x))}  ${x.label}${note}`);
    const phases = topLevelPhases(x.selfReport)
      .sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
      .slice(0, PHASES_SHOWN);
    if (phases.length > 0) {
      out.push(dim(`           ${phases.map(p => `${p.name} ${seconds(p.endMs - p.startMs).trim()}`).join(" · ")}`));
    }
  }

  const path = criticalPath(build);
  out.push(
    "",
    bold("critical path") +
      `  ${seconds(path.totalMs).trim()}` +
      dim("  the longest chain: what a build of everything takes with every core free"),
    dim(
      "  how long each step holds up the next; less than it runs when the next needs only an output it releases early",
    ),
  );
  for (const step of path.steps) {
    const whole = duration(step.execution);
    out.push(
      `  ${seconds(step.blocksNextForMs)}  ${step.execution.label}` +
        (step.blocksNextForMs < whole ? dim(`  of ${seconds(whole).trim()}`) : ""),
    );
  }

  const run = build.runs.at(-1)!;
  const wallMs = Math.max(...run.executions.map(x => x.end));
  const sumMs = run.executions.reduce((sum, x) => sum + duration(x), 0);
  out.push(
    "",
    bold("most recent run of ninja") + `  ${clock(run.epochMs)}`,
    `  ${seconds(wallMs).trim()} wall   ${run.executions.length} edges   ${seconds(sumMs).trim()} of commands   ` +
      `${(sumMs / wallMs).toFixed(1)}× average parallelism`,
  );
  const windows = lowParallelismWindows(run);
  if (windows.length > 0) {
    out.push(
      "",
      `  ${bold("low parallelism")}` +
        dim(`  ${LOW_PARALLELISM_EDGES} commands or fewer for ${LOW_PARALLELISM_MS / 1000}s or more`),
    );
    for (const w of windows) {
      const longest = [...w.running].sort((a, b) => duration(b) - duration(a)).slice(0, WINDOW_EDGES_NAMED);
      const more = w.running.length - longest.length;
      const names =
        w.running.length === 0
          ? "nothing running"
          : longest.map(x => x.label).join(", ") + (more > 0 ? dim(` and ${more} more`) : "");
      out.push(`  ${seconds(w.from)} –${seconds(w.to)}  ${dim(`(${seconds(w.to - w.from).trim()})`)}  ${names}`);
    }
  }
  const queues = queueTimes(build, run).filter(q => q.totalMs > 0);
  if (queues.length > 0) {
    out.push(
      "",
      `  ${bold("waited to start")}` + dim("  after every input existed: for the pool, or for a free job slot"),
    );
    for (const q of queues) {
      const name = q.pool === undefined ? "no pool" : `pool ${q.pool} (depth ${q.depth ?? "?"})`;
      out.push(
        `  ${seconds(q.totalMs)}  ${name.padEnd(28)}${String(q.edges).padStart(5)} ${q.edges === 1 ? "edge " : "edges"}   ` +
          dim(`longest ${seconds(q.longest.ms).trim()}  ${q.longest.execution.label}`),
      );
    }
  }

  if (build.runs.length > 1) {
    out.push(
      "",
      bold("earlier runs still in the log") + dim("  ninja drops an edge's older entries when it compacts the log"),
    );
    const earlier = build.runs.slice(0, -1).reverse();
    for (const r of earlier.slice(0, EARLIER_RUNS_LISTED)) {
      const wall = Math.max(...r.executions.map(x => x.end));
      out.push(`  ${clock(r.epochMs)}  ${String(r.executions.length).padStart(5)} edges  ${seconds(wall)} wall`);
    }
    if (earlier.length > EARLIER_RUNS_LISTED)
      out.push(dim(`  and ${earlier.length - EARLIER_RUNS_LISTED} before those`));
  }
  return out.join("\n") + "\n";
}

// ───────────────────────────────────────────────────────────────────────────
// The trace: every run still in the log as a Gantt chart (Chrome trace events; Perfetto and chrome://tracing read it)
// ───────────────────────────────────────────────────────────────────────────

interface TraceEvent {
  ph: "X" | "M";
  pid: number;
  tid: number;
  name: string;
  cat?: string;
  /** Microseconds. */
  ts?: number;
  dur?: number;
  args?: Record<string, unknown>;
}

/** A compiler phase shorter than this is left out of the trace: a build has hundreds of compilers' worth of them. */
const TRACE_PHASE_FLOOR_MS = 50;

export function traceEvents(build: Build): TraceEvent[] {
  const events: TraceEvent[] = [];
  // Most recent run first: it is the one to look at.
  [...build.runs].reverse().forEach((run, pid) => {
    events.push({ ph: "M", pid, tid: 0, name: "process_name", args: { name: `ninja ${clock(run.epochMs)}` } });
    events.push({ ph: "M", pid, tid: 0, name: "process_sort_index", args: { sort_index: pid } });
    // A row per concurrent command: each goes in the first row that is free when it starts.
    const rowFreeAt: number[] = [];
    for (const x of run.executions) {
      let tid = rowFreeAt.findIndex(freeAt => freeAt <= x.start);
      if (tid < 0) tid = rowFreeAt.length;
      rowFreeAt[tid] = x.end;
      events.push({
        ph: "X",
        pid,
        tid,
        name: x.label,
        cat: x.edge.rule,
        ts: x.start * 1000,
        dur: duration(x) * 1000,
        args: { outputs: x.edge.outputs, ...(x.pool !== undefined ? { pool: x.pool } : {}) },
      });
      for (const [path, after] of x.released) {
        events.push({
          ph: "X",
          pid,
          tid,
          name: `until ${relative(build.buildDir, path)} is released`,
          cat: "released",
          ts: x.start * 1000,
          dur: after * 1000,
        });
      }
      if (build.last.get(x.edge) !== x) continue;
      // Rows nest by time. Phases a compiler ran on other threads overlap without nesting; those stay out.
      const open: Phase[] = [];
      const phases = x.selfReport
        .filter(p => p.endMs - p.startMs >= TRACE_PHASE_FLOOR_MS)
        .sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
      for (const p of phases) {
        while (open.length > 0 && open.at(-1)!.endMs <= p.startMs) open.pop();
        if (open.length > 0 && p.endMs > open.at(-1)!.endMs) continue;
        open.push(p);
        events.push({
          ph: "X",
          pid,
          tid,
          name: p.name,
          cat: "phase",
          ts: (p.startMs - run.epochMs) * 1000,
          dur: (p.endMs - p.startMs) * 1000,
        });
      }
    }
  });
  return events;
}
