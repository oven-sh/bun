/**
 * Where a build's time went: `bun scripts/build.ts --timings` (design: the "Timings" section of CLAUDE.md). The
 * report for the terminal, and the same as a chart (`chartHtml`).
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
 * and, when the build was configured with `--time-trace=on`, what each compiler says about its own phases.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { BuildError } from "./error.ts";
import { type Manifest, type ManifestEdge, type RuleName, expand, readManifest } from "./ninja.ts";
import { rustcPhasesPath } from "./rust/units.ts";
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
const LOG_SIGNATURE = "# ninja log v7";

export function parseNinjaLog(text: string): LogEntry[] {
  const lines = text.split("\n");
  if (lines[0] !== LOG_SIGNATURE) {
    throw new BuildError(`.ninja_log starts with ${JSON.stringify(lines[0])}, not "${LOG_SIGNATURE}"`, {
      hint: "The timings read the log of the ninja this build pins (oven-sh/ninja). Another ninja built this directory.",
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
 * `TimeStampFromFileTime`): 100 ns ticks since `NINJA_WINDOWS_EPOCH_MS`.
 */
function stampToUnixMs(stamp: bigint, windowsHost: boolean): number {
  return windowsHost ? Number(stamp / 10_000n) + NINJA_WINDOWS_EPOCH_MS : Number(stamp / 1_000_000n);
}

/**
 * ninja moves FILETIME's epoch (1601) forward by 12622770400 seconds, which it calls 400 years and is 10400 seconds
 * short of them: its zero is 2000-12-31 21:06:40 UTC, not 2001-01-01.
 */
const NINJA_WINDOWS_EPOCH_MS = Date.UTC(1601, 0, 1) + 12_622_770_400_000;

// A command's stamp and its `start` are read from two clocks at two moments, so `stamp - start` only brackets when
// its ninja started.

/**
 * The stamp can be early: the kernel stamps files from a clock it advances once per timer tick, which is 10 ms on
 * Linux at HZ=100 and 15.6 ms on Windows by default.
 */
const STAMP_EARLY_MS = 16;
/**
 * The stamp can be late: ninja reads its clock, creates the outputs' directories, and only then touches
 * `.ninja_lock`. Up to 57 ms in the log of a build of everything on 32 cores; the bound is that with room to spare.
 */
const STAMP_LATE_MS = 100;
/** ninja starts a command whose last input just appeared in the same pass of its loop (1 to 5 ms in real logs). */
const START_AFTER_INPUT_MS = 10;

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
  /** The command that writes `build.ninja` (a `generator` rule). */
  writesManifest: boolean;
  /**
   * Outputs released before the command ended, by absolute path: milliseconds after `start`. Known only for an
   * edge's last execution, whose files are the ones on disk.
   */
  released: Map<string, number>;
  selfReport: Phase[];
}

/** One run of ninja: a ninja process that ran at least one command, together with the processes it became. */
export interface Run {
  /** Unix milliseconds of the first process's start: what `start` and `end` of its executions count from. */
  epochMs: number;
  /** The end of its last command. */
  wallMs: number;
  executions: Execution[];
}

const duration = (x: Execution): number => x.end - x.start;

/** How long `x` held up whatever reads `path`: until it released that output, which for most is until it ended. */
const heldFor = (x: Execution, path: string): number => x.released.get(path) ?? duration(x);

/**
 * A rule's description with `$out`, `$in` and the edge's own variables expanded, as ninja prints it, with paths into
 * the build directory and the checkout shortened to how the graph and the repository name them.
 */
function describe(where: Where, manifest: Manifest, edge: ManifestEdge): string {
  const text = manifest.rules.get(edge.rule)?.description ?? `${edge.rule} $out`;
  const value = (name: string) =>
    name === "out" ? edge.outputs.join(" ") : name === "in" ? edge.inputs.join(" ") : (edge.bindings[name] ?? "");
  return expand(text, value)
    .replaceAll(resolve(where.buildDir) + sep, "")
    .replaceAll(where.cwd + sep, "")
    .replaceAll(where.cwd, ".")
    .trim();
}

/**
 * Split executions into the runs of ninja that made them. The log does not say: every ninja process counts from its
 * own zero, and ninja rewrites the log in no particular order when it compacts it.
 *
 * What places an execution in a process is its stamp. When the stamp is the command's start, `stamp - start` is when
 * its process started (its epoch), early by at most `STAMP_EARLY_MS` and late by at most `STAMP_LATE_MS`. Two ninjas
 * on one build directory never overlap, so the next process's epoch is past every end of this one: sorted by epoch,
 * an execution belongs to the process before it exactly when its epoch falls before that process's last end so far.
 * When the stamp may be an output's mtime, the epoch lies anywhere in `[stamp - end, stamp - start]`; such an
 * execution goes to the latest process whose epoch that allows, and the ones no process allows (a ninja that only
 * fetched and planned) are processes of their own. One case cannot be told from the log: a command of that kind that
 * left its output unchanged, in a process with nothing to pin it, which ran for longer than the process before it had
 * been over; it is put in that one.
 *
 * The command that writes `build.ninja` is the exception: its stamp is not its own. Every configure stamps
 * `build.ninja` and has ninja record that (`ninja -t restat`, configure.ts), so the entry's stamp is the last
 * configure's, whenever the command ran. Its start and end are still its process's. ninja brings `build.ninja` up to
 * date before anything else, so that process ran nothing but what `build.ninja` needs (`beforeManifest`), and ninja
 * starts the command the moment its last input exists: it belongs to the process made only of such commands in which
 * one that makes an input of it (`feeds`) ended right at its start. With no such process in the log it is in no run.
 *
 * When that command rewrote `build.ninja`, ninja starts over at once with the new graph, counting from zero again.
 * That is one build: the process that begins where it ended is the same run, on the first one's clock.
 */
function groupRuns(executions: Execution[], feeds: Set<ManifestEdge>, beforeManifest: Set<ManifestEdge>): Run[] {
  // The process's epoch is somewhere in [epochLo, epochHi]; `epochMs` is the estimate the run is dated by.
  type Process = Run & { epochLo: number; epochHi: number };
  const processes: Process[] = [];
  const started = (epochLo: number, epochMs: number, epochHi: number): Process => {
    const p = { epochMs, epochLo, epochHi, wallMs: 0, executions: [] };
    processes.push(p);
    return p;
  };
  const add = (p: Process, x: Execution) => {
    p.wallMs = Math.max(p.wallMs, x.end);
    p.executions.push(x);
  };
  const epochOf = (x: Execution) => x.stampMs - x.start;
  const byEpoch = (a: Execution, b: Execution) => epochOf(a) - epochOf(b);
  const placedByStamp = executions.filter(x => !x.writesManifest);

  for (const x of placedByStamp.filter(x => x.stampIsStart).sort(byEpoch)) {
    const p = processes.at(-1);
    const epoch = epochOf(x);
    add(
      p === undefined || epoch >= p.epochMs + p.wallMs
        ? started(epoch - STAMP_LATE_MS, epoch, epoch + STAMP_EARLY_MS)
        : p,
      x,
    );
  }

  const pinned = processes.length;
  for (const x of placedByStamp.filter(x => !x.stampIsStart).sort(byEpoch)) {
    const lo = x.stampMs - x.end - STAMP_LATE_MS;
    const hi = epochOf(x) + STAMP_EARLY_MS;
    const allows = (p: Process) => lo <= p.epochHi && hi >= p.epochLo;
    // Processes with a command that pins the epoch first; then the ones this loop started, the newest of which is
    // the only one still open to an execution in epoch order, and whose bounds each execution narrows.
    let p = processes.slice(0, pinned).filter(allows).at(-1);
    const open = processes.length > pinned ? processes.at(-1)! : undefined;
    if (p === undefined && open !== undefined && allows(open)) {
      p = open;
      p.epochLo = Math.max(p.epochLo, lo);
      p.epochHi = Math.min(p.epochHi, hi);
    }
    add(p ?? started(lo, epochOf(x), hi), x);
  }
  processes.sort((a, b) => a.epochMs - b.epochMs);

  for (const x of executions.filter(x => x.writesManifest)) {
    const ranIt = (p: Process) =>
      p.executions.every(f => beforeManifest.has(f.edge)) &&
      p.executions.some(f => feeds.has(f.edge) && x.start >= f.end && x.start - f.end <= START_AFTER_INPUT_MS);
    const p = processes.filter(ranIt).at(-1);
    if (p !== undefined) add(p, x);
  }

  const runs: Process[] = [];
  for (const next of processes) {
    const run = runs.at(-1);
    const last = run?.executions.reduce((a, b) => (b.end > a.end ? b : a));
    const continues =
      run !== undefined &&
      last!.writesManifest &&
      next.epochLo <= run.epochHi + run.wallMs &&
      next.epochHi >= run.epochLo + run.wallMs;
    if (!continues) {
      runs.push(next);
      continue;
    }
    const restart = run.wallMs;
    for (const x of next.executions) {
      x.start += restart;
      x.end += restart;
      add(run, x);
    }
  }

  for (const run of runs) run.executions.sort((a, b) => a.start - b.start || a.end - b.end);
  return runs;
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

/**
 * How finely a compiler's phases are read. A shorter one is not kept: a translation unit's trace has tens of
 * thousands of events, nearly all of them slivers, and a build has hundreds of translation units. And a phase's times
 * are not trusted closer than this: rustc gives a pass's duration and no clock time, so run.ts dates a pass by when
 * its line arrived, and a pass can seem to start a little after the first pass inside it.
 */
const PHASE_FLOOR_MS = 10;

/** The rules compiled with `cxxflags`, which is where flags.ts puts `-ftime-trace`. */
const clangTraced = new Set<string>(["cxx", "cxx_pch", "pch", "pch_msvc"] satisfies RuleName[]);
const RUSTC: RuleName = "rust_rustc";

/**
 * A compiler's report, or nothing when there is none to read: a build interrupted while the file was being written
 * leaves part of one, which no later build without --time-trace=on rewrites.
 */
function readReport<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function readSelfReport(buildDir: string, edge: ManifestEdge): Phase[] {
  const output = resolve(buildDir, edge.outputs[0]!);
  if (edge.rule === RUSTC) {
    const passes = readReport<Phase[]>(rustcPhasesPath(output)) ?? [];
    return passes.filter(p => p.endMs - p.startMs >= PHASE_FLOOR_MS);
  }
  if (!clangTraced.has(edge.rule)) return [];
  // clang names the trace after the output, with its extension replaced.
  const trace = readReport<ClangTimeTrace>(output.replace(/\.[^./\\]+$/, ".json"));
  const phases: Phase[] = [];
  for (const e of trace?.traceEvents ?? []) {
    // "Total <name>" events are clang's own sums, not stretches of time.
    if (e.ph !== "X" || e.dur === undefined || e.name.startsWith("Total ")) continue;
    if (e.dur < PHASE_FLOOR_MS * 1000) continue;
    const startMs = (trace!.beginningOfTime + e.ts) / 1000;
    const detail = e.args?.detail;
    phases.push({ name: detail ? `${e.name} ${detail}` : e.name, startMs, endMs: startMs + e.dur / 1000 });
  }
  return phases;
}

/** The phases shown for a command: the largest few say where its time went. */
const PHASES_SHOWN = 4;

/**
 * The largest phases that are whole parts of the command: inside nothing but the one phase that spans it all (clang's
 * `ExecuteCompiler`, rustc's `total`). Compilers report phases nested, and only by their times.
 */
function largestPhases(x: Execution): [name: string, ms: number][] {
  const phases = x.selfReport;
  const length = (p: Phase) => p.endMs - p.startMs;
  const root = phases.reduce<Phase | undefined>(
    (a, b) => (a === undefined || length(b) > length(a) ? b : a),
    undefined,
  );
  // Of two phases that span each other to within the floor, the shorter is the inner one (the earlier, if neither).
  const inside = (p: Phase, q: Phase) =>
    q.startMs <= p.startMs + PHASE_FLOOR_MS &&
    p.endMs <= q.endMs + PHASE_FLOOR_MS &&
    (length(q) > length(p) || (length(q) === length(p) && phases.indexOf(q) > phases.indexOf(p)));
  return phases
    .filter(p => p !== root && !phases.some(q => q !== root && q !== p && inside(p, q)))
    .sort((a, b) => length(b) - length(a))
    .slice(0, PHASES_SHOWN)
    .map(p => [p.name, length(p)]);
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
  /** The edge that writes `build.ninja`, and what it needs first: itself and every edge upstream of it. */
  manifestEdge: ManifestEdge | undefined;
  beforeManifest: Set<ManifestEdge>;
}

type Producers = Build["producer"];

/** An edge's inputs of every kind that an edge makes, as `[path, that edge]`. */
function* inputProducers(buildDir: string, producer: Producers, edge: ManifestEdge): Generator<[string, ManifestEdge]> {
  for (const input of [...edge.inputs, ...edge.implicitInputs, ...edge.orderOnlyInputs]) {
    const path = resolve(buildDir, input);
    const from = producer.get(path);
    if (from !== undefined) yield [path, from];
  }
}

/**
 * What an edge waits for: its inputs, and `build.ninja`. No build statement names the manifest as an input, but ninja
 * brings it up to date before it builds anything else, so everything that is not needed for that waits on it.
 */
function* producers(build: Build, edge: ManifestEdge): Generator<[string, ManifestEdge]> {
  yield* inputProducers(build.buildDir, build.producer, edge);
  if (build.manifestEdge !== undefined && !build.beforeManifest.has(edge)) {
    yield [resolve(build.buildDir, build.manifestEdge.outputs[0]!), build.manifestEdge];
  }
}

/** Where a build is: what `Config` says of it. */
export interface Where {
  buildDir: string;
  /** The checkout. */
  cwd: string;
  host: { os: string };
}

export function loadBuild(where: Where): Build {
  const buildDir = resolve(where.buildDir);
  const manifestPath = resolve(buildDir, "build.ninja");
  const logPath = resolve(buildDir, ".ninja_log");
  if (!existsSync(manifestPath) || !existsSync(logPath)) {
    throw new BuildError(`${buildDir} has not been built`, {
      hint: "Timings describe a build that has run: build first, with the same flags and without --configure-only.",
    });
  }
  const manifest = readManifest(readFileSync(manifestPath, "utf8"));
  const producer: Producers = new Map();
  for (const edge of manifest.edges) {
    for (const out of [...edge.outputs, ...edge.implicitOutputs]) producer.set(resolve(buildDir, out), edge);
  }

  // Everything reachable from the manifest's edge through its inputs, going on through the edges `through` accepts.
  const manifestEdge = manifest.edges.find(e => manifest.rules.get(e.rule)?.generator === true);
  const reach = (through: (edge: ManifestEdge) => boolean): Set<ManifestEdge> => {
    const reached = new Set<ManifestEdge>();
    const walk = (edge: ManifestEdge): void => {
      for (const [, from] of inputProducers(buildDir, producer, edge)) {
        if (reached.has(from)) continue;
        reached.add(from);
        if (through(from)) walk(from);
      }
    };
    if (manifestEdge !== undefined) walk(manifestEdge);
    return reached;
  };
  // What makes an input of the manifest's edge, looking through phonies; and everything upstream of it, with itself.
  const feeds = reach(edge => edge.rule === "phony");
  const beforeManifest = reach(() => true);
  if (manifestEdge !== undefined) beforeManifest.add(manifestEdge);

  // An execution is logged once per output, with the same times on each line. Lines whose output no edge makes any
  // more are from a graph that is gone.
  const seen = new Map<string, Execution>();
  for (const entry of parseNinjaLog(readFileSync(logPath, "utf8"))) {
    const edge = producer.get(resolve(buildDir, entry.output));
    if (edge === undefined) continue;
    const key = `${edge.outputs[0]} ${entry.start} ${entry.end} ${entry.stamp}`;
    if (seen.has(key)) continue;
    const rule = manifest.rules.get(edge.rule);
    seen.set(key, {
      edge,
      label: describe(where, manifest, edge),
      pool: edge.bindings.pool ?? rule?.pool,
      start: entry.start,
      end: entry.end,
      stampMs: stampToUnixMs(entry.stamp, where.host.os === "windows"),
      // A restat or generator rule's stamp is its output's mtime when the command changed the output.
      stampIsStart: rule !== undefined && !rule.restat && !rule.generator,
      writesManifest: edge === manifestEdge,
      released: new Map(),
      selfReport: [],
    });
  }
  const executions = [...seen.values()];
  const runs = groupRuns(executions, feeds, beforeManifest);

  const last = new Map<ManifestEdge, Execution>();
  for (const run of runs) for (const x of run.executions) last.set(x.edge, x);
  // The manifest's command can be in no run. ninja appends to the log and compacting it keeps one entry per output,
  // so of one output's lines the last is the latest.
  for (const x of executions) if (x.writesManifest) last.set(x.edge, x);
  for (const x of last.values()) {
    readReleased(buildDir, x);
    x.selfReport = readSelfReport(buildDir, x.edge).filter(
      // A report left by another execution than the logged one (a build that was interrupted) says nothing about it.
      // A compiler reads the process clock, which a file stamp trails.
      p => p.startMs >= x.stampMs - STAMP_LATE_MS && p.endMs <= x.stampMs + duration(x) + STAMP_EARLY_MS,
    );
  }
  return { buildDir, manifest, runs, last, producer, manifestEdge, beforeManifest };
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
  // Files from another execution than the logged one (a build that was interrupted) say nothing about it. The start's
  // stamp can be late, so an output stamped just after the start can seem to come before it.
  if (after.some(ms => ms === undefined || ms < -STAMP_LATE_MS || ms > duration(x) + STAMP_EARLY_MS)) return;
  // The output stamped last is the one the command ended with, not an early one.
  const last = Math.max(...(after as number[]));
  x.edge.outputs.forEach((o, i) => {
    if (after[i]! < last) x.released.set(resolve(buildDir, o), Math.max(0, after[i]!));
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Analysis
// ───────────────────────────────────────────────────────────────────────────

export interface RuleTotal {
  rule: string;
  edges: number;
  totalMs: number;
  slowest: Execution;
}

export function totalsByRule(build: Build): RuleTotal[] {
  const totals = new Map<string, RuleTotal>();
  for (const x of build.last.values()) {
    const t = totals.get(x.edge.rule);
    if (t === undefined) totals.set(x.edge.rule, { rule: x.edge.rule, edges: 1, totalMs: duration(x), slowest: x });
    else {
      t.edges++;
      t.totalMs += duration(x);
      if (duration(x) > duration(t.slowest)) t.slowest = x;
    }
  }
  return [...totals.values()].sort((a, b) => b.totalMs - a.totalMs);
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
    for (const [path, from] of producers(build, edge)) {
      const x = build.last.get(from);
      const blocksNextForMs = x === undefined ? 0 : heldFor(x, path);
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

/** A stretch counts as low parallelism at this many commands or fewer (one chain of crates, or a link and a check) … */
const LOW_PARALLELISM_COMMANDS = 2;
/** … lasting at least this long: shorter ones are the gaps between commands. */
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
    if (was > LOW_PARALLELISM_COMMANDS && running <= LOW_PARALLELISM_COMMANDS) since = at;
    if (was <= LOW_PARALLELISM_COMMANDS && running > LOW_PARALLELISM_COMMANDS && since !== undefined) {
      close(since, at);
      since = undefined;
    }
  }
  if (since !== undefined) close(since, run.wallMs);
  return windows;
}

export interface QueueTotal {
  /** A pool's name; `undefined` for commands in no pool, which wait only for one of ninja's `-j` job slots. */
  pool: string | undefined;
  depth: number | undefined;
  commands: number;
  totalMs: number;
  longest: { execution: Execution; ms: number };
}

/** Why a command started when it did. */
export interface Wait {
  /** Milliseconds between every input existing and the command starting. */
  ms: number;
  /** The command of the same run that made the last of its inputs to exist: what it was waiting on. */
  blocker: Execution | undefined;
  /** When the blocker released that input, on the run's clock: its end, or earlier for an output released early. */
  readyAt: number;
}

/** For each of the run's commands, what it waited on and for how long after that. */
export function waits(build: Build, run: Run): Map<Execution, Wait> {
  const inRun = new Map<ManifestEdge, Execution>(run.executions.map(x => [x.edge, x]));
  interface Ready {
    at: number;
    by: Execution | undefined;
  }
  // When an edge's inputs existed in this run, and which of the run's commands made the last of them; an input
  // whose edge the run did not execute (up to date, or a phony) stands for that edge's own inputs.
  const memo = new Map<ManifestEdge, Ready>();
  const ready = (edge: ManifestEdge): Ready => {
    let r = memo.get(edge);
    if (r !== undefined) return r;
    r = { at: 0, by: undefined };
    memo.set(edge, r);
    for (const [path, from] of producers(build, edge)) {
      const x = inRun.get(from);
      const made: Ready = x === undefined ? ready(from) : { at: x.start + heldFor(x, path), by: x };
      if (made.at > r.at) [r.at, r.by] = [made.at, made.by];
    }
    return r;
  };

  return new Map(
    run.executions.map(x => {
      const r = ready(x.edge);
      return [x, { ms: Math.max(0, x.start - r.at), blocker: r.by, readyAt: r.at }];
    }),
  );
}

/**
 * `waits`, by pool. The log does not say why a command waited: one in a pool waits for the pool or for a job slot,
 * whichever is full.
 */
export function queueTimes(build: Build, run: Run): QueueTotal[] {
  const totals = new Map<string | undefined, QueueTotal>();
  for (const [x, { ms }] of waits(build, run)) {
    const t = totals.get(x.pool);
    if (t === undefined) {
      const depth = x.pool === "console" ? 1 : x.pool === undefined ? undefined : build.manifest.pools.get(x.pool);
      totals.set(x.pool, { pool: x.pool, depth, commands: 1, totalMs: ms, longest: { execution: x, ms } });
    } else {
      t.commands++;
      t.totalMs += ms;
      if (ms > t.longest.ms) t.longest = { execution: x, ms };
    }
  }
  return [...totals.values()].sort((a, b) => b.totalMs - a.totalMs);
}

// ───────────────────────────────────────────────────────────────────────────
// The report
// ───────────────────────────────────────────────────────────────────────────

/** An elapsed time in a column. */
const column = (ms: number): string => formatElapsed(ms).padStart(10);
const clock = (unixMs: number): string => new Date(unixMs).toISOString().replace("T", " ").slice(0, 19) + "Z";

export interface ReportStyle {
  bold(s: string): string;
  dim(s: string): string;
}

const SLOWEST_EDGES = 20;
const EARLIER_RUNS_LISTED = 10;
/** A low-parallelism window names the longest of the commands that ran in it. */
const WINDOW_COMMANDS_NAMED = 4;

export function formatReport(build: Build, style: ReportStyle): string {
  const { bold, dim } = style;
  const out: string[] = [];
  const executions = [...build.last.values()];
  const run = build.runs.at(-1);

  out.push(`${bold("build timings")}  ${relative(process.cwd(), build.buildDir) || "."}`);
  if (run === undefined) {
    out.push("  nothing in the log yet");
    return out.join("\n") + "\n";
  }
  out.push(`  ${formatElapsed(run.wallMs)} total · ${executions.length} edges`);

  out.push(
    "",
    bold("by rule".padEnd(26)) + dim(`${"edges".padStart(7)}${"total".padStart(12)}  ${"slowest".padStart(10)}`),
  );
  for (const t of totalsByRule(build)) {
    out.push(
      `  ${t.rule.padEnd(24)}${String(t.edges).padStart(7)}  ${column(t.totalMs)}  ${column(duration(t.slowest))}  ${dim(t.slowest.label)}`,
    );
  }

  out.push("", bold(`slowest ${Math.min(SLOWEST_EDGES, executions.length)} edges`));
  for (const x of [...executions].sort((a, b) => duration(b) - duration(a)).slice(0, SLOWEST_EDGES)) {
    out.push(`  ${column(duration(x))}  ${x.label}`);
    const phases = largestPhases(x);
    if (phases.length > 0) {
      out.push(dim(`${"".padStart(14)}${phases.map(([name, ms]) => `${name} ${formatElapsed(ms)}`).join(" · ")}`));
    }
  }

  out.push("", bold("critical path") + dim("  how long each step holds up the next"));
  for (const step of criticalPath(build).steps) {
    const whole = duration(step.execution);
    out.push(
      `  ${column(step.blocksNextForMs)}  ${step.execution.label}` +
        (step.blocksNextForMs < whole ? dim(`  of ${formatElapsed(whole)}`) : ""),
    );
  }

  // What exists only within one build: for the last one, the one build nothing can have overwritten part of.
  const sumMs = run.executions.reduce((sum, x) => sum + duration(x), 0);
  out.push(
    "",
    bold("last build") +
      `  ${clock(run.epochMs)}` +
      dim(`  ${run.executions.length} commands · ${(sumMs / run.wallMs).toFixed(1)}× parallel`),
  );
  const windows = lowParallelismWindows(run);
  if (windows.length > 0) {
    out.push(
      "",
      `  ${bold("low parallelism")}` + dim(`  ≤ ${LOW_PARALLELISM_COMMANDS} commands, ≥ ${LOW_PARALLELISM_MS / 1000}s`),
    );
    for (const w of windows) {
      const longest = [...w.running].sort((a, b) => duration(b) - duration(a)).slice(0, WINDOW_COMMANDS_NAMED);
      const more = w.running.length - longest.length;
      const names =
        w.running.length === 0
          ? "nothing running"
          : longest.map(x => x.label).join(", ") + (more > 0 ? dim(` and ${more} more`) : "");
      out.push(`  ${column(w.from)} –${column(w.to)}  ${dim(`(${formatElapsed(w.to - w.from)})`)}  ${names}`);
    }
  }
  const queues = queueTimes(build, run).filter(q => q.totalMs > 0);
  if (queues.length > 0) {
    out.push("", `  ${bold("queued")}`);
    for (const q of queues) {
      const name = q.pool === undefined ? "no pool" : `pool ${q.pool} (depth ${q.depth ?? "?"})`;
      out.push(
        `  ${column(q.totalMs)}  ${name.padEnd(28)}${String(q.commands).padStart(5)} ${q.commands === 1 ? "command " : "commands"}   ` +
          dim(`longest ${formatElapsed(q.longest.ms)}  ${q.longest.execution.label}`),
      );
    }
  }

  if (build.runs.length > 1) {
    out.push("", bold("earlier builds"));
    const earlier = build.runs.slice(0, -1).reverse();
    for (const r of earlier.slice(0, EARLIER_RUNS_LISTED)) {
      out.push(`  ${clock(r.epochMs)}  ${column(r.wallMs)} · ${r.executions.length} commands`);
    }
    if (earlier.length > EARLIER_RUNS_LISTED)
      out.push(dim(`  and ${earlier.length - EARLIER_RUNS_LISTED} before those`));
  }
  return out.join("\n") + "\n";
}

// ───────────────────────────────────────────────────────────────────────────
// The chart: <buildDir>/timings.html. One page, no dependencies, the data inside it.
//
// Each of the most recent builds is a Gantt chart: a bar per command from its start to its end, in a lane for what it
// is, under a strip of how many commands of each color were running. The commands on the critical path are outlined
// where they ran, and joined: each step starts where the one before it released what it needed, which for a library
// crate is the tick inside its bar (its `.rmeta`), not its end. Under the cursor, and for a bar that was clicked, the
// same is drawn for the chain of commands that bar waited on.
// ───────────────────────────────────────────────────────────────────────────

/**
 * A lane of the chart: commands that are the same sort of work, top to bottom in the order a build gets to them.
 * Lanes are told apart by their labels; a lane's color (`--k0` to `--k3` in the page) is one of the three hues that
 * stay apart for every pair of them under color-vision deficiency on both a light and a dark page, or the neutral.
 * The strip of running commands is stacked by color, in the colors' order.
 */
const lanes = [
  { name: "dependencies", color: 2 },
  { name: "codegen", color: 2 },
  { name: "Rust", color: 1 },
  { name: "C and C++", color: 0 },
  { name: "link and checks", color: 3 },
  { name: "other", color: 3 },
] as const;
type Lane = (typeof lanes)[number]["name"];

const ruleLane: Record<RuleName, Lane> = {
  dep_build: "dependencies",
  dep_cargo: "dependencies",
  dep_cargo_cross: "dependencies",
  dep_check_undefined: "dependencies",
  dep_codegen: "dependencies",
  dep_configure: "dependencies",
  dep_fetch: "dependencies",
  dep_fetch_prebuilt: "dependencies",
  dep_host_cc: "dependencies",
  dep_prebuild: "dependencies",
  dep_subst: "dependencies",
  bun_install: "codegen",
  codegen: "codegen",
  codegen_bun: "codegen",
  esbuild: "codegen",
  npm_install: "codegen",
  rust_build_script: "Rust",
  rust_plan: "Rust",
  rust_rustc: "Rust",
  cc: "C and C++",
  cxx: "C and C++",
  cxx_pch: "C and C++",
  nasm: "C and C++",
  pch: "C and C++",
  pch_msvc: "C and C++",
  rc: "C and C++",
  ar: "link and checks",
  binary_verify: "link and checks",
  copy_exe: "link and checks",
  dsymutil: "link and checks",
  duplicate_symbols: "link and checks",
  link: "link and checks",
  shim_verify: "link and checks",
  smoke_test: "link and checks",
  strip: "link and checks",
  bk_upload: "other",
  bk_upload_gz: "other",
  host_tool_cc: "other",
  mkdir_stamp: "other",
  regen: "other",
  shim_crt_decompress: "other",
};

export interface ChartBar {
  label: string;
  rule: string;
  /** Index into the run's `lanes`, and the row within that lane. */
  lane: number;
  row: number;
  start: number;
  end: number;
  /** Its place on the critical path, when it is on it. */
  step: number | undefined;
  /** Milliseconds after `start` that it held up the next step of the path. */
  blocksNextForMs: number | undefined;
  /** Milliseconds after `start` that it released an output to its dependents. */
  released: number | undefined;
  waited: number;
  /** The bar (index into the run's `bars`) that made the last of its inputs to exist, and when it released it. */
  blocker: number | undefined;
  readyAt: number;
  pool: string | undefined;
  phases: [name: string, ms: number][];
}

export interface ChartLane {
  name: string;
  color: number;
  rows: number;
}

export interface ChartRun {
  title: string;
  wallMs: number;
  /** The lanes this run has commands in. */
  lanes: ChartLane[];
  bars: ChartBar[];
}

export interface ChartData {
  buildDir: string;
  edges: number;
  /** Most recent first. */
  runs: ChartRun[];
}

/** The runs the page draws: the most recent, and as many before it as the report lists. */
const RUNS_DRAWN = 1 + EARLIER_RUNS_LISTED;

function chartRun(build: Build, run: Run, steps: Map<Execution, { step: number; blocksNextForMs: number }>): ChartRun {
  const waited = waits(build, run);
  const index = new Map(run.executions.map((x, i) => [x, i]));
  const laneOf = (x: Execution): Lane => ruleLane[x.edge.rule as RuleName] ?? "other";
  const used = lanes.filter(lane => run.executions.some(x => laneOf(x) === lane.name));
  // A bar goes in the first row of its lane with nothing in its way. The critical path is placed first, so its steps
  // take the top rows of their lanes and read as a staircase.
  const taken = used.map((): { start: number; end: number }[][] => []);
  const place = (x: Execution): { lane: number; row: number } => {
    const lane = used.findIndex(l => l.name === laneOf(x));
    const rows = taken[lane]!;
    let row = rows.findIndex(bars => bars.every(b => b.end <= x.start || b.start >= x.end));
    if (row < 0) row = rows.push([]) - 1;
    rows[row]!.push(x);
    return { lane, row };
  };
  const placed = new Map<Execution, { lane: number; row: number }>();
  for (const x of run.executions) if (steps.has(x)) placed.set(x, place(x));
  for (const x of run.executions) if (!steps.has(x)) placed.set(x, place(x));
  return {
    title: clock(run.epochMs),
    wallMs: run.wallMs,
    lanes: used.map((lane, i) => ({ name: lane.name, color: lane.color, rows: taken[i]!.length })),
    bars: run.executions.map(x => ({
      label: x.label,
      rule: x.edge.rule,
      ...placed.get(x)!,
      start: x.start,
      end: x.end,
      step: steps.get(x)?.step,
      blocksNextForMs: steps.get(x)?.blocksNextForMs,
      released: x.released.size > 0 ? Math.min(...x.released.values()) : undefined,
      waited: waited.get(x)!.ms,
      blocker: index.get(waited.get(x)!.blocker!),
      readyAt: waited.get(x)!.readyAt,
      pool: x.pool,
      phases: largestPhases(x),
    })),
  };
}

export function chartData(build: Build): ChartData {
  const path = criticalPath(build);
  const steps = new Map(path.steps.map((s, step) => [s.execution, { step, blocksNextForMs: s.blocksNextForMs }]));
  return {
    buildDir: relative(process.cwd(), build.buildDir) || ".",
    edges: build.last.size,
    runs: [...build.runs]
      .reverse()
      .slice(0, RUNS_DRAWN)
      .map(run => chartRun(build, run, steps)),
  };
}

export function chartHtml(build: Build): string {
  // `<` escaped so that no label can end the script element.
  const data = JSON.stringify(chartData(build)).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>build timings</title>
<style>${css}</style>
</head>
<body>
<main class="viz-root">
  <header>
    <h1>build timings</h1>
    <p id="where"></p>
    <div id="tiles"></div>
  </header>
  <div id="runs"></div>
</main>
<div id="tip" hidden></div>
<script id="data" type="application/json">${data}</script>
<script>${client.replace("FORMAT_ELAPSED", () => formatElapsed.toString())}</script>
</body>
</html>
`;
}

// The three hues pass an all-pairs check for color-vision-deficiency and normal-vision separation on each surface.
const css = `
:root {
  color-scheme: light;
  --surface: #fcfcfb; --raised: #f3f2ef; --text: #0b0b0b; --text-2: #52514e; --grid: #e4e3df;
  --k0: #2a78d6; --k1: #eb6834; --k2: #1baf7a; --k3: #a3a29b;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --surface: #1a1a19; --raised: #262624; --text: #ffffff; --text-2: #c3c2b7; --grid: #383835;
    --k0: #3987e5; --k1: #d95926; --k2: #199e70; --k3: #6f6e68;
  }
}
body { margin: 0; background: var(--surface); color: var(--text); font: 14px/1.4 system-ui, sans-serif; }
.viz-root { padding: 24px; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 32px 0 2px; }
p, .meta { color: var(--text-2); margin: 2px 0 0; }
#tiles { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
.tile { background: var(--raised); border-radius: 8px; padding: 10px 14px; min-width: 150px; }
.tile b { display: block; font-size: 22px; font-weight: 600; }
.tile span { color: var(--text-2); font-size: 12px; }
.run { position: relative; display: flex; margin-top: 8px; border-radius: 8px; background: var(--raised); }
.gutter { position: relative; flex: none; width: 124px; border-right: 1px solid var(--grid); }
.lane { position: absolute; left: 10px; right: 6px; font-size: 11px; line-height: 16px; color: var(--text-2); white-space: nowrap; }
.lane i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }
.scroll { overflow-x: auto; flex: 1; min-width: 0; }
svg { display: block; }
svg text { font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--text-2); }
svg text.in { fill: #0b0b0b; pointer-events: none; }
.bar { rx: 2px; cursor: pointer; }
.faded { opacity: 0.55; }
.onpath { stroke: var(--text); stroke-width: 1.5px; }
.bar:hover { opacity: 1; stroke: var(--text); stroke-width: 1px; }
.dim { opacity: 0.13; }
text.dim { opacity: 0.25; }
.join { stroke: var(--text); stroke-width: 1.5px; fill: none; pointer-events: none; }
.join.forward { stroke-width: 1px; opacity: 0.6; }
.join.hover { stroke-dasharray: 4 3; }
.span { stroke: var(--text); stroke-width: 2px; pointer-events: none; }
svg text.at { fill: var(--text); font-weight: 600; pointer-events: none; }
.hoverbar { fill: none; stroke: var(--text); stroke-width: 1.5px; stroke-dasharray: 4 3; rx: 2px; pointer-events: none; }
.tickmark { stroke: var(--surface); stroke-width: 2px; pointer-events: none; }
.grid { stroke: var(--grid); stroke-width: 1px; }
.split { position: absolute; left: 0; right: 0; background: var(--surface); pointer-events: none; }
.running { opacity: 0.85; }
#tip { position: fixed; z-index: 1; max-width: 420px; background: var(--surface); color: var(--text); border: 1px solid var(--grid);
  border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.2); pointer-events: none; }
#tip b { display: block; word-break: break-all; }
#tip div { color: var(--text-2); }
`;

// Plain JavaScript, kept free of template literals so it can sit inside one.
const client = `
(function () {
  var data = JSON.parse(document.getElementById("data").textContent);
  var NS = "http://www.w3.org/2000/svg";
  var ROW = 14, BAR = 12, RIGHT = 24, STRIP = 50, SPLIT = 8, TICKS = 16, AT = 14, AXIS = TICKS + AT, GAP = 10, LANE_GAP = 12, THIN_ROW = 5, NAMED_SHARE = 0.03;
  // The width of a character of a bar's name (10px monospace), and the colors a lane can have (--k0 to --k3).
  var CHAR = 6.05, COLORS = 4;
  var level = 1, MOST_ZOOM = 200;
  var tip = document.getElementById("tip");

  var ms = FORMAT_ELAPSED;
  // A moment on the time axis: seconds alone, to as many places as the distance between ticks needs.
  function onAxis(t, step) { return (t / 1000).toFixed(step >= 1000 ? 0 : step >= 100 ? 1 : 2) + "s"; }
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function html(tag, text, parent, cls) {
    var e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  document.getElementById("where").textContent = data.buildDir;
  var tiles = document.getElementById("tiles");
  function tile(value, caption) { var t = html("div", undefined, tiles, "tile"); html("b", value, t); html("span", caption, t); }
  if (data.runs.length > 0) tile(ms(data.runs[0].wallMs), "total");
  tile(String(data.edges), "edges");
  function barIndex(ev) {
    var i = ev.target.getAttribute && ev.target.getAttribute("data-i");
    return i === null || i === undefined ? undefined : Number(i);
  }


  function niceStep(span, width) {
    var steps = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
    for (var i = 0; i < steps.length; i++) if (span / steps[i] * 90 <= width) return steps[i];
    return steps[steps.length - 1];
  }

  function draw(run, host, gutter) {
    var scrolled = host.scrollLeft;
    host.textContent = "";
    gutter.textContent = "";
    var plot = plotWidth(host);
    // The chart's left edge, which is the lane names' border, is the start of the build.
    var width = plot + RIGHT;
    var x = function (t) { return t / run.wallMs * plot; };
    host.plot = plot;
    // A row is full height when a bar in it is on the critical path or lasts a share of the run that can carry a
    // name with the whole run in view, and thin when it holds only slivers: a burst of short commands then costs
    // little room. Decided from the data, not from the zoom, so zooming only stretches the chart sideways.
    var barWidth = function (b) { return Math.max(1.5, x(b.end) - x(b.start)); };
    var chars = function (b) { return Math.floor((barWidth(b) - 8) / CHAR); };
    var tall = run.lanes.map(function (lane) { return new Array(lane.rows).fill(false); });
    run.bars.forEach(function (b) {
      if (b.step !== undefined || (b.end - b.start) / run.wallMs >= NAMED_SHARE) tall[b.lane][b.row] = true;
    });
    var laneTop = [], rowTop = [], top = STRIP + SPLIT + GAP;
    run.lanes.forEach(function (lane, i) {
      laneTop.push(top);
      rowTop.push(tall[i].map(function (isTall) { var at = top; top += isTall ? ROW : THIN_ROW; return at; }));
      top += LANE_GAP;
    });
    var y = function (b) { return rowTop[b.lane][b.row]; };
    var h = function (b) { return tall[b.lane][b.row] ? BAR : THIN_ROW - 1; };
    var height = top - LANE_GAP + GAP + AXIS;
    var svg = el("svg", { width: width, height: height, role: "img", "aria-label": "commands of the run at " + run.title }, host);

    var step = niceStep(run.wallMs, plot);
    for (var t = 0; t <= run.wallMs; t += step) {
      // The start needs no grid line: the chart's edge is it.
      if (t > 0) el("line", { x1: x(t), x2: x(t), y1: 0, y2: height - AXIS, "class": "grid" }, svg);
      el("text", { x: x(t) + 3, y: height - AXIS + TICKS - 4 }, svg).textContent = onAxis(t, step);
    }

    // The lanes, named in the gutter beside the chart so the names stay put when the chart scrolls.
    gutter.style.height = height + "px";
    run.lanes.forEach(function (lane, i) {
      var name = html("div", undefined, gutter, "lane");
      name.style.top = laneTop[i] - 2 + "px";
      html("i", undefined, name).style.background = "var(--k" + lane.color + ")";
      name.appendChild(document.createTextNode(lane.name));
      if (i > 0) el("line", { x1: 0, x2: width, y1: laneTop[i] - LANE_GAP / 2, y2: laneTop[i] - LANE_GAP / 2, "class": "grid" }, svg);
    });

    // How many commands were running, stacked by color from the bottom.
    var events = [];
    run.bars.forEach(function (b) { var c = run.lanes[b.lane].color; events.push([b.start, 1, c], [b.end, -1, c]); });
    events.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var most = 0, now = 0;
    events.forEach(function (e) { now += e[1]; if (now > most) most = now; });
    for (var upTo = COLORS - 1; upTo >= 0; upTo--) {
      var d = "M" + x(0) + "," + STRIP, running = 0;
      events.forEach(function (e) {
        if (e[2] > upTo) return;
        running += e[1];
        // The strip's panel is its scale: nothing running is its bottom edge, the most at once is its top.
        d += "H" + x(e[0]) + "V" + (STRIP - running / most * STRIP);
      });
      el("path", { d: d + "H" + x(run.wallMs) + "V" + STRIP + "Z", fill: "var(--k" + upTo + ")", "class": "running" }, svg);
    }

    // What is outlined and joined. With nothing pinned: the critical path. With a bar pinned: the chain of commands
    // this run waited on before it, each joined to the one it was waiting on, and lit, every command it held up.
    var steps = run.bars.filter(function (b) { return b.step !== undefined; }).sort(function (a, b) { return a.step - b.step; });
    var links = [], forward = [], chain = {}, held = {};
    // The join from the bar a bar waited on; the bars it waited on, back to the start of the run.
    var waitedOn = function (b) { return [run.bars[b.blocker], b.readyAt, b]; };
    var chainOf = function (i) { var out = []; for (var at = i; at !== undefined; at = run.bars[at].blocker) out.push(at); return out; };
    if (run.pinned === undefined) {
      // Only steps that follow each other: after incremental builds a run holds some of the path's steps, not all.
      for (var i = 0; i + 1 < steps.length; i++) {
        if (steps[i + 1].step === steps[i].step + 1) links.push([steps[i], steps[i].start + steps[i].blocksNextForMs, steps[i + 1]]);
      }
    } else {
      chainOf(run.pinned).forEach(function (at) {
        chain[at] = true;
        if (run.bars[at].blocker !== undefined) links.push(waitedOn(run.bars[at]));
      });
      var heldUp = {};
      run.bars.forEach(function (b, i) { if (b.blocker !== undefined) (heldUp[b.blocker] = heldUp[b.blocker] || []).push(i); });
      for (var queue = [run.pinned]; queue.length > 0; ) {
        (heldUp[queue.pop()] || []).forEach(function (i) {
          held[i] = true;
          queue.push(i);
          forward.push(waitedOn(run.bars[i]));
        });
      }
    }
    // From where one command released what the next needed, down or up to the next one's row, then along to its
    // start: along the gap between rows, so the line never runs through the bars (and names) of that row.
    var join = function (link, cls, parent) {
      var x1 = x(link[1]), x2 = x(link[2].start);
      var y1 = y(link[0]) + h(link[0]) / 2, to = link[2];
      if (y(link[0]) === y(to)) return;
      var gap = y1 < y(to) ? y(to) - 1 : y(to) + h(to) + 1;
      el("path", { d: "M" + x1 + "," + y1 + "V" + gap + "H" + x2, "class": cls }, parent);
    };
    // Only while a bar is pinned: what is being shown, in numbers the chart does not give.
    run.note.textContent = run.pinned === undefined ? "" :
      run.bars[run.pinned].label + " · waited on " + (Object.keys(chain).length - 1) + " before it · held up " +
      Object.keys(held).length + " · Esc to unpin";

    var outlined = function (b, i) { return run.pinned === undefined ? b.step !== undefined : chain[i]; };
    var lit = function (b, i) { return run.pinned === undefined ? steps.length === 0 : held[i]; };
    // With a bar pinned, what has nothing to do with it all but disappears; otherwise the rest only steps back.
    var away = run.pinned === undefined ? " faded" : " dim";
    run.bars.forEach(function (b, i) {
      el("rect", {
        x: x(b.start), y: y(b), width: barWidth(b), height: h(b), fill: "var(--k" + run.lanes[b.lane].color + ")",
        "class": "bar" + (outlined(b, i) ? " onpath" : lit(b, i) ? "" : away), "data-i": i,
      }, svg);
      if (b.released !== undefined) {
        el("line", { x1: x(b.start + b.released), x2: x(b.start + b.released), y1: y(b), y2: y(b) + h(b), "class": "tickmark" }, svg);
      }
      var fits = chars(b);
      if (fits >= 5 && tall[b.lane][b.row]) {
        var label = b.label.length > fits ? b.label.slice(0, fits - 1) + "…" : b.label;
        var related = outlined(b, i) || lit(b, i) || run.pinned === undefined;
        el("text", { x: x(b.start) + 4, y: y(b) + BAR - 3, "class": related ? "in" : "in dim" }, svg).textContent = label;
      }
    });
    forward.forEach(function (link) { join(link, "join forward", svg); });
    links.forEach(function (link) { join(link, "join", svg); });

    // Under the cursor: the chain the bar waited on, without pinning anything.
    var hoverLayer = el("g", {}, svg), hovered;
    var showChain = function (i) {
      if (i === hovered) return;
      hovered = i;
      hoverLayer.textContent = "";
      if (i === undefined) return;
      chainOf(i).forEach(function (at) {
        var b = run.bars[at];
        el("rect", { x: x(b.start), y: y(b), width: barWidth(b), height: h(b), "class": "hoverbar" }, hoverLayer);
        if (b.blocker !== undefined) join(waitedOn(b), "join hover", hoverLayer);
      });
      // When the bar started and ended, in a row of its own under the axis's ticks. Each time is written outside
      // the span it bounds, or both on the side that has room, at either end of the chart.
      var bar = run.bars[i], from = x(bar.start), to = x(bar.start) + barWidth(bar), row = height - AT / 2;
      el("line", { x1: from, x2: to, y1: row, y2: row, "class": "span" }, hoverLayer);
      var at = function (xAt, anchor, text) {
        el("text", { x: xAt, y: row + 4, "text-anchor": anchor, "class": "at" }, hoverLayer).textContent = text;
      };
      var room = function (text) { return text.length * CHAR + 6; };
      var began = onAxis(bar.start, 100), ended = onAxis(bar.end, 100), both = began + " – " + ended;
      if (from < room(began)) at(to + 3, "start", both);
      else if (to + room(ended) > width) at(from - 3, "end", both);
      else {
        at(from - 3, "end", began);
        at(to + 3, "start", ended);
      }
    };

    svg.addEventListener("mousemove", function (ev) {
      var i = barIndex(ev);
      showChain(i);
      if (i === undefined) { tip.hidden = true; return; }
      var b = run.bars[i];
      tip.textContent = "";
      html("b", b.label, tip);
      html("div", b.rule + (b.pool ? " · pool " + b.pool : ""), tip);
      html("div", ms(b.end - b.start), tip);
      // How long it sat ready before it started. What it was waiting for until then is the line drawn from it.
      html("div", "queued " + ms(b.waited), tip);
      if (b.phases.length > 0) html("div", b.phases.map(function (p) { return p[0] + " " + ms(p[1]); }).join(" · "), tip);
      tip.hidden = false;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - tw - 8) + "px";
      // Below the cursor, unless that would run off the window or over the chart's time axis.
      var axisTop = svg.getBoundingClientRect().bottom - AXIS;
      var below = ev.clientY + 18 + th <= Math.min(window.innerHeight, axisTop);
      tip.style.top = (below ? ev.clientY + 18 : ev.clientY - th - 10) + "px";
    });
    svg.addEventListener("mouseleave", function () { tip.hidden = true; showChain(undefined); });
    svg.addEventListener("click", function (ev) {
      var i = barIndex(ev);
      run.pinned = i === run.pinned ? undefined : i;
      draw(run, host, gutter);
    });
    host.scrollLeft = scrolled;
  }

  var runs = document.getElementById("runs");
  var gutters = [];
  var hosts = data.runs.map(function (run, i) {
    html("h2", run.title, runs);
    var sum = run.bars.reduce(function (s, b) { return s + b.end - b.start; }, 0);
    // The first chart's time is the page's total.
    html("div", (i === 0 ? "" : ms(run.wallMs) + " · ") + run.bars.length + " commands · " +
      (sum / run.wallMs).toFixed(1) + "× parallel", runs, "meta");
    run.note = html("div", undefined, runs, "meta");
    var row = html("div", undefined, runs, "run");
    // The strip of running commands is a panel of its own above the lanes, on the same time axis: a gap of the
    // page's own color under it, across the lane names and the chart.
    var split = html("div", undefined, row, "split");
    split.style.top = STRIP + "px";
    split.style.height = SPLIT + "px";
    gutters.push(html("div", undefined, row, "gutter"));
    return html("div", undefined, row, "scroll");
  });
  function plotWidth(host) { return Math.max(320, host.clientWidth) * level - RIGHT; }
  function drawAll() { data.runs.forEach(function (run, i) { draw(run, hosts[i], gutters[i]); }); }
  // Zoom every chart, keeping the moment under the cursor (or, away from the cursor, at the middle of the view) still.
  function zoomTo(value, overHost, clientX) {
    var anchors = hosts.map(function (host) {
      var at = host === overHost ? clientX - host.getBoundingClientRect().left : host.clientWidth / 2;
      return { at: at, moment: (host.scrollLeft + at) / host.plot };
    });
    level = Math.min(MOST_ZOOM, Math.max(1, value));
    drawAll();
    hosts.forEach(function (host, i) { host.scrollLeft = anchors[i].moment * host.plot - anchors[i].at; });
  }
  // The charts are as wide as the page gives them, which changes with the window and when a scroll bar appears.
  new ResizeObserver(drawAll).observe(runs);
  window.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    data.runs.forEach(function (run) { run.pinned = undefined; });
    drawAll();
  });
  hosts.forEach(function (host) {
    var turned = 0, clientX = 0, queued = false;
    host.addEventListener("wheel", function (ev) {
      // A sideways scroll pans the chart.
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
      ev.preventDefault();
      turned += ev.deltaY * (ev.deltaMode === 1 ? 16 : 1);
      clientX = ev.clientX;
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        // Up zooms in, down zooms out; a notch of a wheel (about 100) is a quarter more or less.
        zoomTo(level * Math.exp(-turned * 0.0022), host, clientX);
        turned = 0;
      });
    }, { passive: false });
  });
  drawAll();
})();
`;
