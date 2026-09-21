/**
 * Where a build's time went: `bun scripts/build.ts --timings` (design: the "Timings" section of CLAUDE.md).
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

/** The stamp can be early: the kernel stamps files from a clock it advances once per timer tick (10 ms at HZ=100). */
const STAMP_EARLY_MS = 10;
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
  /** When ninja started over with a rewritten `build.ninja`, on the run's clock. */
  restarts: number[];
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
    const p = { epochMs, epochLo, epochHi, wallMs: 0, executions: [], restarts: [] };
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
    run.restarts.push(restart);
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
export function largestPhases(x: Execution): [name: string, ms: number][] {
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
const column = (ms: number): string => formatElapsed(ms).padStart(7);
export const clock = (unixMs: number): string => new Date(unixMs).toISOString().replace("T", " ").slice(0, 19) + "Z";

export interface ReportStyle {
  bold(s: string): string;
  dim(s: string): string;
}

const SLOWEST_EDGES = 20;
export const EARLIER_RUNS_LISTED = 10;
/** A low-parallelism window names the longest of the commands that ran in it. */
const WINDOW_COMMANDS_NAMED = 4;

export function formatReport(build: Build, style: ReportStyle): string {
  const { bold, dim } = style;
  const out: string[] = [];
  const executions = [...build.last.values()];
  const neverBuilt = build.manifest.edges.filter(e => e.rule !== "phony" && !build.last.has(e)).length;
  const runsOfLast = build.runs.filter(r => r.executions.some(x => build.last.get(x.edge) === x)).length;

  out.push(`${bold("build timings")}  ${relative(process.cwd(), build.buildDir) || "."}`);
  if (executions.length === 0) {
    out.push("  no edge of build.ninja is in the log yet");
    return out.join("\n") + "\n";
  }
  const run = build.runs.at(-1);
  if (run === undefined) {
    out.push("  the log has only the command that writes build.ninja, which says nothing about when it ran");
    return out.join("\n") + "\n";
  }
  const stamps = executions.filter(x => !x.writesManifest).map(x => x.stampMs);
  out.push(
    `  ${executions.length} edges, last built by ${runsOfLast} ${runsOfLast === 1 ? "run" : "runs"} of ninja` +
      ` between ${clock(Math.min(...stamps))} and ${clock(Math.max(...stamps))}` +
      (neverBuilt > 0 ? dim(`  (${neverBuilt} more have not been built)`) : ""),
  );

  out.push(
    "",
    bold("by rule".padEnd(26)) + dim(`${"edges".padStart(7)}${"total".padStart(9)}  ${"slowest".padStart(7)}`),
  );
  for (const t of totalsByRule(build)) {
    out.push(
      `  ${t.rule.padEnd(24)}${String(t.edges).padStart(7)}  ${column(t.totalMs)}  ${column(duration(t.slowest))}  ${dim(t.slowest.label)}`,
    );
  }

  out.push("", bold(`slowest ${Math.min(SLOWEST_EDGES, executions.length)} edges`));
  for (const x of [...executions].sort((a, b) => duration(b) - duration(a)).slice(0, SLOWEST_EDGES)) {
    const early = [...x.released.values()];
    const note = early.length > 0 ? dim(`  dependents can start after ${formatElapsed(Math.min(...early))}`) : "";
    out.push(`  ${column(duration(x))}  ${x.label}${note}`);
    const phases = largestPhases(x);
    if (phases.length > 0) {
      out.push(dim(`           ${phases.map(([name, ms]) => `${name} ${formatElapsed(ms)}`).join(" · ")}`));
    }
  }

  const path = criticalPath(build);
  out.push(
    "",
    bold("critical path") +
      `  ${formatElapsed(path.totalMs)}` +
      dim("  the longest chain: what a build of everything takes with every core free"),
    dim(
      "  how long each step holds up the next; less than it runs when the next needs only an output it releases early",
    ),
  );
  for (const step of path.steps) {
    const whole = duration(step.execution);
    out.push(
      `  ${column(step.blocksNextForMs)}  ${step.execution.label}` +
        (step.blocksNextForMs < whole ? dim(`  of ${formatElapsed(whole)}`) : ""),
    );
  }

  const sumMs = run.executions.reduce((sum, x) => sum + duration(x), 0);
  out.push(
    "",
    bold("most recent run of ninja") + `  ${clock(run.epochMs)}`,
    `  ${formatElapsed(run.wallMs)} wall   ${run.executions.length} commands taking ${formatElapsed(sumMs)}   ` +
      `${(sumMs / run.wallMs).toFixed(1)}× average parallelism`,
    ...run.restarts.map(at => dim(`  ninja started over at ${formatElapsed(at)}: build.ninja was rewritten`)),
  );
  const windows = lowParallelismWindows(run);
  if (windows.length > 0) {
    out.push(
      "",
      `  ${bold("low parallelism")}` +
        dim(`  ${LOW_PARALLELISM_COMMANDS} commands or fewer for ${LOW_PARALLELISM_MS / 1000}s or more`),
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
    out.push(
      "",
      `  ${bold("waited to start")}` + dim("  after every input existed: for the pool, or for a free job slot"),
    );
    for (const q of queues) {
      const name = q.pool === undefined ? "no pool" : `pool ${q.pool} (depth ${q.depth ?? "?"})`;
      out.push(
        `  ${column(q.totalMs)}  ${name.padEnd(28)}${String(q.commands).padStart(5)} ${q.commands === 1 ? "command " : "commands"}   ` +
          dim(`longest ${formatElapsed(q.longest.ms)}  ${q.longest.execution.label}`),
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
      out.push(`  ${clock(r.epochMs)}  ${String(r.executions.length).padStart(5)} commands  ${column(r.wallMs)} wall`);
    }
    if (earlier.length > EARLIER_RUNS_LISTED)
      out.push(dim(`  and ${earlier.length - EARLIER_RUNS_LISTED} before those`));
  }
  return out.join("\n") + "\n";
}
