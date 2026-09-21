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
  /** The command that writes `build.ninja` (a `generator` rule). */
  writesManifest: boolean;
  run: Run;
  /**
   * Outputs released before the command ended, by absolute path: milliseconds after `start`. Known only for an
   * edge's last execution, whose files are the ones on disk.
   */
  released: Map<string, number>;
  selfReport: Phase[];
}

/**
 * One run of ninja: a ninja process that ran at least one command, together with the processes it became. ninja brings
 * `build.ninja` up to date before anything else, and when that rewrote the file it starts over with the new graph,
 * counting from zero again. That is one build, so it is one run here, on the first process's clock.
 */
export interface Run {
  /** Unix milliseconds of the first process's start: what `start` and `end` of its executions count from. */
  epochMs: number;
  executions: Execution[];
  /** When ninja started over with a rewritten `build.ninja`, on the run's clock. */
  restarts: number[];
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
 * Split executions into the runs of ninja that made them. The log does not say: every ninja process counts from its
 * own zero, and ninja rewrites the log in no particular order when it compacts it.
 *
 * What places an execution in a process is its stamp. When the stamp is the command's start, `stamp - start` is
 * when its process started (its epoch), give or take `STAMP_SLACK_MS`. Two ninjas on one build directory never
 * overlap, so the next process's epoch is past every end of this one: sorted by epoch, an execution belongs to the
 * process before it exactly when its epoch falls before that process's last end so far. When the stamp may be an
 * output's mtime, all it says is that the epoch lies in `[stamp - end, stamp - start]`; such an execution goes to the
 * latest process whose epoch that allows, and the ones no process allows (a ninja that only fetched and planned) are
 * processes of their own.
 *
 * The command that writes `build.ninja` is the exception: its stamp is not its own. Every configure stamps
 * `build.ninja` and has ninja record that (`ninja -t restat`, configure.ts), so the entry's stamp is the last
 * configure's, whenever the command ran. Its start and end are still its process's, and ninja starts it the moment
 * its last input exists, so it belongs to the process in which a command that makes one of its inputs (`feeds`) ended
 * right at its start. With no such process in the log it is in no run (`Build.last` still has how long it took).
 *
 * A process whose last command wrote `build.ninja` started over at once, counting from zero again: the process that
 * begins where it ended is the same run, on the first one's clock.
 */
function groupRuns(executions: Omit<Execution, "run">[], feeds: Set<ManifestEdge>): Run[] {
  // A process's epoch is known to lie in [epochLo, epochHi]; `epochMs` is the estimate the run is dated by.
  type Process = Run & { epochLo: number; epochHi: number; lastEnd: number };
  const processes: Process[] = [];
  const started = (epochLo: number, epochHi: number): Process => {
    const p = { epochMs: epochHi, epochLo, epochHi, lastEnd: 0, executions: [], restarts: [] };
    processes.push(p);
    return p;
  };
  const add = (p: Process, x: Omit<Execution, "run">) => {
    p.lastEnd = Math.max(p.lastEnd, x.end);
    p.executions.push(Object.assign(x, { run: p }));
  };
  const epochOf = (x: Omit<Execution, "run">) => x.stampMs - x.start;
  const byEpoch = (a: Omit<Execution, "run">, b: Omit<Execution, "run">) => epochOf(a) - epochOf(b);
  const placedByStamp = executions.filter(x => !x.writesManifest);

  for (const x of placedByStamp.filter(x => x.stampIsStart).sort(byEpoch)) {
    let p = processes.at(-1);
    if (p === undefined || epochOf(x) >= p.epochLo + p.lastEnd) {
      p = started(epochOf(x), epochOf(x));
      p.epochMs = epochOf(x);
    }
    p.epochHi = epochOf(x);
    add(p, x);
  }

  const pinned = processes.length;
  for (const x of placedByStamp.filter(x => !x.stampIsStart).sort(byEpoch)) {
    const lo = x.stampMs - x.end;
    const hi = epochOf(x);
    // Processes with a command that pins the epoch first; then the ones this loop started, the newest of which is
    // the only one still open to an execution in epoch order.
    let p = processes
      .slice(0, pinned)
      .filter(r => r.epochLo <= hi + STAMP_SLACK_MS && r.epochHi >= lo - STAMP_SLACK_MS)
      .at(-1);
    const open = processes.length > pinned ? processes.at(-1)! : undefined;
    if (p === undefined && open !== undefined && lo - STAMP_SLACK_MS <= open.epochHi) {
      p = open;
      p.epochLo = Math.max(p.epochLo, lo);
    }
    add(p ?? started(lo, hi), x);
  }
  processes.sort((a, b) => a.epochMs - b.epochMs);

  for (const x of executions.filter(x => x.writesManifest)) {
    const after = (p: Process) =>
      p.executions.some(f => feeds.has(f.edge) && x.start >= f.end && x.start - f.end <= STAMP_SLACK_MS);
    const p = processes.filter(after).at(-1);
    // In no run: a process that is not among the runs.
    if (p === undefined) Object.assign(x, { run: { epochMs: x.stampMs - x.end, executions: [x], restarts: [] } });
    else add(p, x);
  }

  const runs: Process[] = [];
  for (const next of processes) {
    const run = runs.at(-1);
    const last = run?.executions.reduce((a, b) => (b.end > a.end ? b : a));
    const continues =
      run !== undefined &&
      last!.writesManifest &&
      next.epochHi + STAMP_SLACK_MS >= run.epochLo + run.lastEnd &&
      next.epochLo - STAMP_SLACK_MS <= run.epochHi + run.lastEnd;
    if (!continues) {
      runs.push(next);
      continue;
    }
    const restart = run.lastEnd;
    run.restarts.push(restart);
    // The continuation's epoch is pinned by its compilers; the first process's was only bounded.
    run.epochLo = Math.max(run.epochLo, next.epochLo - restart - STAMP_SLACK_MS);
    run.epochHi = Math.min(run.epochHi, next.epochHi - restart + STAMP_SLACK_MS);
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
  /** The edge that writes `build.ninja`, and what it needs first: itself and every edge upstream of it. */
  manifestEdge: ManifestEdge | undefined;
  beforeManifest: Set<ManifestEdge>;
}

/**
 * What an edge waits for, as `[path, the edge that makes it]`: its inputs of every kind, and `build.ninja`. No build
 * statement names the manifest as an input, but ninja brings it up to date before it builds anything else, so
 * everything that is not needed for that waits on it.
 */
function* producers(build: Build, edge: ManifestEdge): Generator<[string, ManifestEdge]> {
  for (const input of [...edge.inputs, ...edge.implicitInputs, ...edge.orderOnlyInputs]) {
    const path = resolve(build.buildDir, input);
    const from = build.producer.get(path);
    if (from !== undefined) yield [path, from];
  }
  if (build.manifestEdge !== undefined && !build.beforeManifest.has(edge)) {
    yield [resolve(build.buildDir, build.manifestEdge.outputs[0]!), build.manifestEdge];
  }
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
      writesManifest: rule?.generator === true,
      released: new Map(),
      selfReport: [],
    });
  }
  const manifestEdge = manifest.edges.find(e => manifest.rules.get(e.rule)?.generator === true);
  // The edges that make an input of the manifest's edge, looking through phonies.
  const feeds = new Set<ManifestEdge>();
  const feeding = (edge: ManifestEdge): void => {
    for (const input of [...edge.inputs, ...edge.implicitInputs, ...edge.orderOnlyInputs]) {
      const from = producer.get(resolve(buildDir, input));
      if (from === undefined || feeds.has(from)) continue;
      feeds.add(from);
      if (from.rule === "phony") feeding(from);
    }
  };
  if (manifestEdge !== undefined) feeding(manifestEdge);
  const executions = [...seen.values()];
  const runs = groupRuns(executions, feeds);

  const last = new Map<ManifestEdge, Execution>();
  for (const run of runs) for (const x of run.executions) last.set(x.edge, x);
  // The manifest's command is placed by where it ran, not by when: the log's own order says which was last.
  for (const x of executions) if (x.writesManifest) last.set(x.edge, x as Execution);
  for (const x of last.values()) {
    readReleased(buildDir, x);
    x.selfReport = readSelfReport(buildDir, x.edge).filter(
      // A report left by another execution than the logged one (a build that was interrupted) says nothing about it.
      p => p.startMs >= x.stampMs - STAMP_SLACK_MS && p.endMs <= x.stampMs + duration(x) + STAMP_SLACK_MS,
    );
  }
  const build: Build = { buildDir, manifest, runs, last, producer, manifestEdge, beforeManifest: new Set() };
  const upstream = (edge: ManifestEdge): void => {
    if (build.beforeManifest.has(edge)) return;
    build.beforeManifest.add(edge);
    for (const [, from] of producers(build, edge)) upstream(from);
  };
  if (build.manifestEdge !== undefined) upstream(build.manifestEdge);
  return build;
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
    for (const [path, from] of producers(build, edge)) {
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

/** Why a command started when it did. */
export interface Wait {
  /** Milliseconds between every input existing and the command starting. */
  ms: number;
  /** The command of the same run that made the last of its inputs to exist: what it was waiting on. */
  blocker: Execution | undefined;
  /** When the blocker released that input, on the run's clock: its end, or earlier for an output released early. */
  readyAt: number;
  /** How many commands of the run made an input of this one. */
  inputs: number;
}

/** For each of the run's commands, what it waited on and for how long after that. */
export function waits(build: Build, run: Run): Map<Execution, Wait> {
  const inRun = new Map<ManifestEdge, Execution>(run.executions.map(x => [x.edge, x]));
  interface Ready {
    at: number;
    by: Execution | undefined;
    makers: Set<Execution>;
  }
  // When an edge's inputs existed in this run, and which of the run's commands made them; an input whose edge the
  // run did not execute (up to date, or a phony) stands for that edge's own inputs.
  const memo = new Map<ManifestEdge, Ready>();
  const ready = (edge: ManifestEdge): Ready => {
    let r = memo.get(edge);
    if (r !== undefined) return r;
    r = { at: 0, by: undefined, makers: new Set() };
    memo.set(edge, r);
    for (const [path, from] of producers(build, edge)) {
      const x = inRun.get(from);
      const through = x === undefined ? ready(from) : undefined;
      const at = through?.at ?? x!.start + (x!.released.get(path) ?? duration(x!));
      if (through !== undefined) for (const m of through.makers) r.makers.add(m);
      else r.makers.add(x!);
      if (at > r.at) [r.at, r.by] = [at, through?.by ?? x];
    }
    return r;
  };

  return new Map(
    run.executions.map(x => {
      const r = ready(x.edge);
      return [x, { ms: Math.max(0, x.start - r.at), blocker: r.by, readyAt: r.at, inputs: r.makers.size }];
    }),
  );
}

/**
 * `waits`, by pool. The log does not say why an edge waited: an edge in a pool waits for the pool or for a job slot,
 * whichever is full.
 */
export function queueTimes(build: Build, run: Run): QueueTotal[] {
  const totals = new Map<string | undefined, QueueTotal>();
  for (const [x, { ms }] of waits(build, run)) {
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
  const runsOfLast = new Set(executions.map(x => x.run).filter(run => build.runs.includes(run)));

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

  const wallMs = Math.max(...run.executions.map(x => x.end));
  const sumMs = run.executions.reduce((sum, x) => sum + duration(x), 0);
  out.push(
    "",
    bold("most recent run of ninja") + `  ${clock(run.epochMs)}`,
    `  ${seconds(wallMs).trim()} wall   ${run.executions.length} edges   ${seconds(sumMs).trim()} of commands   ` +
      `${(sumMs / wallMs).toFixed(1)}× average parallelism`,
    ...run.restarts.map(at => dim(`  ninja started over at ${seconds(at).trim()}: build.ninja was rewritten`)),
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
          ts: (x.start + p.startMs - x.stampMs) * 1000,
          dur: (p.endMs - p.startMs) * 1000,
        });
      }
    }
  });
  return events;
}
