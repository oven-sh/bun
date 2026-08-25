/**
 * The build engine: incremental task execution, in process.
 *
 * This is what ninja did for us, reduced to what the build needs and written
 * against our own types. Build modules declare work as tasks (an argv, the
 * files it reads and writes, what it must run after), then `run()` executes
 * everything that is out of date, in parallel, bounded by pools.
 *
 * A task is out of date when: an output is missing; a task it depends on ran
 * and changed its outputs; an input or a header the compiler reported last
 * time is newer than the task's last start time (or is gone); the command or
 * key differs from the one recorded; or it asks to always run (nested builds
 * that track their own staleness, e.g. cargo, combined with `restat`).
 *
 * `restat: true` means "my outputs may come out identical" (writeIfChanged
 * codegen, cargo no-op): the engine compares output mtimes before and after
 * and only marks the task `changed` when they moved, so dependents can skip.
 *
 * State lives next to the outputs (`build-log.ts`): per output, the command
 * hash, the filesystem time the command started, its duration (scheduler
 * weight), and the header deps parsed from the depfile (`depfile.ts`).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import { BuildLog, DepsLog } from "./build-log.ts";
import { parseDepfile, parseShowIncludes } from "./depfile.ts";
import { BuildError } from "./error.ts";

/** How a task does its work. Every path is absolute. */
export type Command =
  | { argv: string[]; cwd?: string | undefined; env?: Record<string, string> | undefined }
  /**
   * A shell command line, run by `sh -c` (posix) or handed to CreateProcess
   * (windows) the way ninja did. Only the bridge for not-yet-ported emitters
   * produces these; new code uses `argv`.
   */
  | { shell: string; cwd?: string | undefined; env?: Record<string, string> | undefined };

export interface TaskSpec {
  /** Group for display and for `--only`: "cxx", "link", "fetch", "codegen", … */
  kind: string;
  /** Shown next to the kind while running: the main output, or the dep name. */
  label: string;
  /** Files this task writes. At least one, unless it is an alias. */
  outputs: string[];
  /** Files this task reads. A newer one than the last run → rerun. */
  inputs?: string[] | undefined;
  /**
   * Must finish first, but their outputs are not inputs (generated headers
   * the depfile will track, directory stamps). A string names an alias or an
   * output path and is resolved when the build runs, so declaration order
   * does not matter. A string that names nothing is ignored.
   */
  after?: (Task | string)[] | undefined;
  /** What to run. A list runs in order and stops at the first failure (link, then a post-link fixup). */
  command?: Command | Command[] | undefined;
  /** Written before the command runs, removed after it succeeds. */
  rspfile?: { path: string; content: string } | undefined;
  /** Where the compiler reports the headers it read. */
  depfile?: { kind: "gcc"; path: string } | { kind: "msvc" } | undefined;
  /** Outputs may be byte-identical after a run; only a moved mtime counts as a change. */
  restat?: boolean | undefined;
  /** Run every build (the command decides what is stale). Pair with `restat`. */
  alwaysRun?: boolean | undefined;
  /** Concurrency group. Unknown pools are unlimited (within `jobs`). */
  pool?: string | undefined;
  /** Owns the terminal while it runs (cargo, the linker). A pool of one. */
  console?: boolean | undefined;
  /** Extra material for the change key, when argv does not capture everything. */
  key?: string | undefined;
}

export interface TaskResult {
  /** The command ran (dry run: would have run). */
  ran: boolean;
  /** Outputs differ from before. Dependents rerun. */
  changed: boolean;
  /** The command failed, or a task it depends on did. */
  failed: boolean;
}

export interface EngineOptions {
  buildDir: string;
  hostOs: string;
  env: NodeJS.ProcessEnv;
  /** Overall parallelism. Default: cores + 2. */
  jobs?: number | undefined;
  /** Failures tolerated before no new task starts. 0 = unlimited. Default 1. */
  keepGoing?: number | undefined;
  /** Show commands instead of labels. */
  verbose?: boolean | undefined;
  /** Decide what would run, run nothing. */
  dryRun?: boolean | undefined;
  /** Say why each task runs (stderr). */
  explain?: boolean | undefined;
  /** tty: one status line. plain: a line per task (CI logs). quiet: failures only. */
  display?: "tty" | "plain" | "quiet" | undefined;
  /** Parent fd exposed as fd 3 to every child (stream.ts live output). */
  streamFd?: number | undefined;
  /** Pool depths. `console` is always 1. */
  pools?: Record<string, number> | undefined;
}

interface ResolvedOptions {
  buildDir: string;
  hostOs: string;
  env: NodeJS.ProcessEnv;
  jobs: number;
  keepGoing: number;
  verbose: boolean;
  dryRun: boolean;
  explain: boolean;
  display: "tty" | "plain" | "quiet";
  streamFd: number | undefined;
}

export interface RunSummary {
  ok: boolean;
  ran: number;
  failed: number;
  interrupted: boolean;
}

type State = "pending" | "running" | "done" | "failed" | "skipped";

/** A declared unit of work. Await `task.result` after `Engine.run()` starts. */
export class Task {
  readonly id: number;
  readonly spec: TaskSpec;
  readonly result: Promise<TaskResult>;
  /** @internal */
  resolve!: (r: TaskResult) => void;
  /** @internal */
  state: State = "pending";
  /** @internal */
  startMtime = 0;
  /** @internal */
  startTime = 0;
  /** @internal Scheduling priority: see Engine.computePriorities. */
  weight = 1;

  constructor(id: number, spec: TaskSpec) {
    this.id = id;
    this.spec = spec;
    this.result = new Promise<TaskResult>(res => {
      this.resolve = res;
    });
  }

  get phony(): boolean {
    return this.spec.command === undefined;
  }

  /** @internal */
  get commands(): Command[] {
    const c = this.spec.command;
    return c === undefined ? [] : Array.isArray(c) ? c : [c];
  }
}

/** A semaphore whose waiters are served by priority (heaviest task first), then FIFO. */
class Pool {
  readonly depth: number;
  private active = 0;
  private readonly queue: { priority: number; seq: number; go: () => void }[] = [];
  private seq = 0;

  constructor(depth: number) {
    this.depth = depth;
  }

  acquire(priority: number): Promise<void> {
    if (this.active < this.depth) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise(go => {
      this.queue.push({ priority, seq: this.seq++, go });
    });
  }

  release(): void {
    this.active--;
    if (this.queue.length === 0) return;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i]!;
      const b = this.queue[best]!;
      if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    const [next] = this.queue.splice(best, 1);
    this.active++;
    next!.go();
  }

  /** Wake every waiter; they see the aborted build and skip. */
  abort(): void {
    for (const w of this.queue.splice(0)) {
      this.active++;
      w.go();
    }
  }
}

export class Engine {
  readonly buildDir: string;
  private readonly opts: ResolvedOptions;
  private readonly tasks: Task[] = [];
  private readonly producers = new Map<string, Task>();
  private readonly aliases = new Map<string, Task>();
  private readonly pools = new Map<string, Pool>();
  private readonly jobsPool: Pool;
  private readonly log: BuildLog;
  private readonly deps: DepsLog;
  private readonly lockPath: string;
  private readonly mtimes = new Map<string, number>();
  private readonly children = new Map<Task, ChildProcess>();

  private started = false;
  private planned = 0;
  private startedCount = 0;
  private finishedCount = 0;
  private ranCount = 0;
  private failures = 0;
  private interrupted = false;
  private statusLineActive = false;
  private consoleActive = false;

  constructor(opts: EngineOptions) {
    this.buildDir = resolve(opts.buildDir);
    this.opts = {
      buildDir: this.buildDir,
      hostOs: opts.hostOs,
      env: opts.env,
      jobs: opts.jobs ?? availableParallelism() + 2,
      keepGoing: opts.keepGoing ?? 1,
      verbose: opts.verbose ?? false,
      dryRun: opts.dryRun ?? false,
      explain: opts.explain ?? false,
      display: opts.display ?? (process.stdout.isTTY ? "tty" : "plain"),
      streamFd: opts.streamFd,
    };
    this.jobsPool = new Pool(this.opts.jobs);
    this.pools.set("console", new Pool(1));
    for (const [name, depth] of Object.entries(opts.pools ?? {})) this.pools.set(name, new Pool(depth));
    this.log = new BuildLog(this.buildDir);
    this.deps = new DepsLog(this.buildDir);
    this.lockPath = resolve(this.buildDir, ".build_lock");
  }

  // ─── Declaration ───

  /** Declare a task. Nothing runs until `run()`. */
  task(spec: TaskSpec): Task {
    if (this.started) throw new BuildError("engine: task() after run()");
    if (spec.outputs.length === 0) throw new BuildError(`engine: task '${spec.kind} ${spec.label}' has no outputs`);
    const task = new Task(this.tasks.length, {
      ...spec,
      outputs: spec.outputs.map(p => this.abs(p)),
      inputs: (spec.inputs ?? []).map(p => this.abs(p)),
    });
    for (const out of task.spec.outputs) {
      const prev = this.producers.get(out);
      if (prev !== undefined) {
        throw new BuildError(`engine: two tasks produce ${this.rel(out)}`, {
          hint: `${prev.spec.kind} ${prev.spec.label} and ${spec.kind} ${spec.label}`,
        });
      }
      this.producers.set(out, task);
    }
    this.tasks.push(task);
    return task;
  }

  /** A named group of tasks (`bun`, `check`, `codegen`). Runs nothing itself. */
  alias(name: string, after: (Task | string)[]): Task {
    if (this.aliases.has(name)) throw new BuildError(`engine: duplicate alias '${name}'`);
    const task = new Task(this.tasks.length, { kind: "alias", label: name, outputs: [], after });
    this.aliases.set(name, task);
    this.aliases.set(this.abs(name), task);
    this.tasks.push(task);
    return task;
  }

  /** Resolve `--target` names: an alias, or an output path. */
  lookup(name: string): Task | undefined {
    return this.aliases.get(name) ?? this.producers.get(this.abs(name));
  }

  /** buildDir-relative form of an absolute path, for display and response files. */
  rel(p: string): string {
    const r = relative(this.buildDir, p);
    return r.startsWith("..") ? p : r;
  }

  get aliasNames(): string[] {
    return [...this.aliases.keys()];
  }

  // ─── Execution ───

  /** Run the given tasks (default: every declared task) and everything they depend on. */
  async run(targets?: Task[]): Promise<RunSummary> {
    if (this.started) throw new BuildError("engine: run() twice");
    this.started = true;
    this.log.load();
    this.deps.load();

    const wanted = targets === undefined ? this.tasks : this.closure(targets);
    this.planned = wanted.filter(t => !t.phony).length;
    this.computePriorities(wanted);

    const onSignal = () => this.interrupt();
    const events = process as unknown as NodeJS.EventEmitter;
    events.on("SIGINT", onSignal);
    events.on("SIGTERM", onSignal);
    try {
      await Promise.all(wanted.map(t => this.execute(t)));
    } finally {
      events.off("SIGINT", onSignal);
      events.off("SIGTERM", onSignal);
      this.log.close();
      this.deps.close();
      rmSync(this.lockPath, { force: true });
      this.endStatusLine();
    }

    if (this.interrupted) {
      this.print("interrupted by user\n", true);
      return { ok: false, ran: this.ranCount, failed: this.failures, interrupted: true };
    }
    if (this.failures > 0) {
      const what = this.failures === 1 ? "1 task failed" : `${this.failures} tasks failed`;
      this.print(`build stopped: ${what}.\n`, true);
      return { ok: false, ran: this.ranCount, failed: this.failures, interrupted: false };
    }
    if (this.ranCount === 0) this.print("no work to do.\n");
    return { ok: true, ran: this.ranCount, failed: 0, interrupted: false };
  }

  /**
   * Pool priority = the longest chain of work from this task to the end of
   * the build, in ms of last recorded duration (1 ms for a task with no
   * history). The PCH ranks above the hundreds of dep compiles that are
   * ready at the same time, because 150 compiles wait on it and nothing
   * waits on them but the link. Same heuristic as ninja's critical path.
   */
  private computePriorities(wanted: Task[]): void {
    const dependents = new Map<Task, Task[]>();
    const inSet = new Set(wanted);
    for (const t of wanted) {
      for (const d of this.dependencies(t)) {
        if (!inSet.has(d)) continue;
        let list = dependents.get(d);
        if (list === undefined) dependents.set(d, (list = []));
        list.push(t);
      }
    }
    const own = (t: Task): number => {
      if (t.phony) return 0;
      const entry = this.log.lookup(t.spec.outputs[0]!);
      return entry !== undefined && entry.durationMs > 0 ? entry.durationMs : 1;
    };
    const memo = new Map<Task, number>();
    const critical = (t: Task): number => {
      const cached = memo.get(t);
      if (cached !== undefined) return cached;
      let rest = 0;
      for (const d of dependents.get(t) ?? []) rest = Math.max(rest, critical(d));
      const v = own(t) + rest;
      memo.set(t, v);
      return v;
    };
    for (const t of wanted) t.weight = critical(t);
  }

  /** The tasks `targets` depend on, transitively, plus themselves. */
  private closure(targets: Task[]): Task[] {
    const seen = new Set<Task>();
    const visit = (t: Task) => {
      if (seen.has(t)) return;
      seen.add(t);
      for (const d of this.dependencies(t)) visit(d);
    };
    for (const t of targets) visit(t);
    return this.tasks.filter(t => seen.has(t));
  }

  private dependencies(task: Task): Task[] {
    const deps = new Set<Task>();
    for (const a of task.spec.after ?? []) {
      const t = typeof a === "string" ? this.lookup(a) : a;
      if (t !== undefined && t !== task) deps.add(t);
    }
    for (const input of task.spec.inputs ?? []) {
      const p = this.producers.get(input) ?? this.aliases.get(input);
      if (p !== undefined && p !== task) deps.add(p);
    }
    return [...deps];
  }

  /** Inputs that are files: alias names listed as inputs only order the build. */
  private fileInputs(task: Task): string[] {
    return (task.spec.inputs ?? []).filter(p => !this.aliases.has(p));
  }

  private async execute(task: Task): Promise<TaskResult> {
    if (task.state !== "pending") return task.result;
    task.state = "running";
    const result = await this.evaluate(task);
    task.resolve(result);
    return result;
  }

  private async evaluate(task: Task): Promise<TaskResult> {
    const deps = this.dependencies(task);
    const upstream = await Promise.all(deps.map(d => this.execute(d)));
    if (upstream.some(r => r.failed) || this.interrupted || !this.canStart()) {
      task.state = "skipped";
      if (!task.phony) this.planned--;
      return { ran: false, changed: false, failed: true };
    }

    if (task.phony) {
      task.state = "done";
      return { ran: false, changed: upstream.some(r => r.changed), failed: false };
    }

    const reason = this.whyDirty(task, deps, upstream);
    if (reason === undefined) {
      task.state = "done";
      this.planned--;
      return { ran: false, changed: false, failed: false };
    }
    this.explain(`${task.spec.kind} ${task.spec.label}: ${reason}`);

    // The pool slot first (the scarce one), then a global job slot. Both
    // queues serve the heaviest waiting task first.
    const pool = task.spec.console ? this.pools.get("console")! : this.pools.get(task.spec.pool ?? "");
    if (pool !== undefined) await pool.acquire(task.weight);
    await this.jobsPool.acquire(task.weight);
    try {
      if (!this.canStart()) {
        task.state = "skipped";
        this.planned--;
        return { ran: false, changed: false, failed: true };
      }
      return await this.runTask(task);
    } finally {
      this.jobsPool.release();
      pool?.release();
    }
  }

  private canStart(): boolean {
    if (this.interrupted) return false;
    return this.opts.keepGoing === 0 || this.failures < this.opts.keepGoing;
  }

  // ─── Dirtiness ───

  /** undefined when up to date; otherwise the first reason to rerun. */
  private whyDirty(task: Task, deps: Task[], upstream: TaskResult[]): string | undefined {
    const { spec } = task;
    if (spec.alwaysRun) return "always runs";
    for (let i = 0; i < deps.length; i++) {
      if (upstream[i]!.changed) return `${deps[i]!.spec.kind} ${deps[i]!.spec.label} changed`;
    }
    for (const out of spec.outputs) {
      if (this.mtime(out) === 0) return `${this.rel(out)} is missing`;
    }
    const primary = spec.outputs[0]!;
    const entry = this.log.lookup(primary);
    if (entry === undefined) return "not in the build log";
    if (entry.commandHash !== this.hash(task)) return "command changed";

    let inputs: readonly string[] = this.fileInputs(task);
    if (spec.depfile !== undefined) {
      const recorded = this.deps.lookup(primary);
      if (recorded === undefined) return "no header deps recorded";
      if (this.mtime(primary) > recorded.mtime) return `${this.rel(primary)} changed since its deps were recorded`;
      inputs = [...inputs, ...recorded.deps];
    }
    let oldestOutput = Infinity;
    for (const out of spec.outputs) oldestOutput = Math.min(oldestOutput, this.mtime(out));
    for (const input of inputs) {
      const m = this.mtime(input);
      if (m === 0) return `${this.rel(input)} is missing`;
      if (m > entry.startMtime) return `${this.rel(input)} is newer than the last run`;
      if (spec.restat !== true && m > oldestOutput) return `${this.rel(input)} is newer than ${this.rel(primary)}`;
    }
    return undefined;
  }

  private hash(task: Task): string {
    const { spec } = task;
    const h = createHash("sha1");
    for (const cmd of task.commands) {
      if ("argv" in cmd) h.update(JSON.stringify([cmd.argv, cmd.cwd ?? "", cmd.env ?? {}]));
      else h.update(JSON.stringify([cmd.shell, cmd.cwd ?? "", cmd.env ?? {}]));
    }
    if (spec.rspfile !== undefined) h.update("\0rsp\0" + spec.rspfile.content);
    if (spec.key !== undefined) h.update("\0key\0" + spec.key);
    return h.digest("hex").slice(0, 16);
  }

  // ─── Running one task ───

  private async runTask(task: Task): Promise<TaskResult> {
    const { spec } = task;
    const before = spec.outputs.map(o => this.mtime(o));
    for (const out of spec.outputs) mkdirSync(dirname(out), { recursive: true });
    if (spec.rspfile !== undefined && !this.opts.dryRun) {
      mkdirSync(dirname(this.abs(spec.rspfile.path)), { recursive: true });
      writeFileSync(this.abs(spec.rspfile.path), spec.rspfile.content);
    }
    task.startMtime = this.opts.dryRun ? 0 : this.fsNow();
    task.startTime = Date.now();
    this.ranCount++;
    this.startedCount++;
    this.statusStarted(task);

    let failure: string | undefined;
    let failedCommand: Command | undefined;
    let output = "";
    let stdout = "";
    if (!this.opts.dryRun) {
      for (const cmd of task.commands) {
        const r = await this.spawnCommand(task, cmd);
        output += r.output;
        stdout += r.stdout;
        if (r.spawnError !== undefined) failure = `failed to start: ${r.spawnError.message}`;
        else if (r.signal !== null) failure = `terminated by ${r.signal}`;
        else if (r.code !== 0) failure = `exit code ${r.code}`;
        if (failure !== undefined || this.interrupted) {
          failedCommand = cmd;
          break;
        }
      }
    }
    this.finishedCount++;

    let headerDeps: string[] | undefined;
    if (failure === undefined && !this.opts.dryRun && spec.depfile !== undefined) {
      const extracted = this.extractDeps(task, stdout);
      if (extracted.error !== undefined) failure = extracted.error;
      else {
        headerDeps = extracted.deps;
        if (extracted.filteredStdout !== undefined) output = extracted.filteredStdout + output.slice(stdout.length);
      }
    }

    if (failure !== undefined || this.interrupted) {
      task.state = "failed";
      this.failures++;
      if (!this.interrupted) this.reportFailure(task, failedCommand, output, failure ?? "interrupted");
      return { ran: true, changed: false, failed: true };
    }

    if (spec.rspfile !== undefined) rmSync(this.abs(spec.rspfile.path), { force: true });
    this.statusFinished(task, output);

    let changed = true;
    if (!this.opts.dryRun) {
      for (const out of spec.outputs) this.mtimes.delete(out);
      if (spec.restat === true) {
        changed = spec.outputs.some((o, i) => this.mtime(o) !== before[i]);
      }
      this.log.record(spec.outputs, {
        commandHash: this.hash(task),
        startMtime: task.startMtime,
        durationMs: Date.now() - task.startTime,
      });
      if (headerDeps !== undefined) this.deps.record(spec.outputs[0]!, this.mtime(spec.outputs[0]!), headerDeps);
    }
    task.state = "done";
    return { ran: true, changed, failed: false };
  }

  private spawnCommand(
    task: Task,
    cmd: Command,
  ): Promise<{
    code: number;
    signal: NodeJS.Signals | null;
    spawnError: Error | undefined;
    output: string;
    stdout: string;
  }> {
    const inherit = task.spec.console === true && this.opts.display !== "quiet";
    const stdio: (number | "pipe" | "inherit" | "ignore")[] = inherit
      ? ["inherit", "inherit", "inherit"]
      : ["ignore", "pipe", "pipe"];
    if (this.opts.streamFd !== undefined) stdio[3] = this.opts.streamFd;
    if (inherit) this.consoleBegin();

    const env = cmd.env !== undefined ? { ...this.opts.env, ...cmd.env } : this.opts.env;
    const cwd = cmd.cwd ?? this.buildDir;
    const windows = this.opts.hostOs === "windows";
    let child: ChildProcess;
    if ("argv" in cmd) {
      const [program, ...args] = cmd.argv;
      child = spawn(program!, args, { cwd, env, stdio, windowsHide: true, detached: !windows && !inherit });
    } else if (windows) {
      // ninja handed the raw line to CreateProcess. node wants a program plus
      // arguments: split off the first token, pass the rest verbatim.
      const { program, rest } = splitProgram(cmd.shell);
      child = spawn(program, rest.length > 0 ? [rest] : [], {
        cwd,
        env,
        stdio,
        argv0: /\s/.test(program) ? `"${program}"` : program,
        windowsVerbatimArguments: true,
        windowsHide: true,
      });
    } else {
      // Own process group, so a terminal ^C reaches only us and we forward it.
      // Console jobs stay in ours and get it directly. Same as ninja.
      child = spawn("/bin/sh", ["-c", cmd.shell], { cwd, env, stdio, detached: !inherit });
    }
    this.children.set(task, child);

    return new Promise(done => {
      const chunks: Buffer[] = [];
      const stdoutChunks: Buffer[] = [];
      child.stdout?.on("data", (c: Buffer) => {
        chunks.push(c);
        stdoutChunks.push(c);
      });
      child.stderr?.on("data", (c: Buffer) => chunks.push(c));
      let spawnError: Error | undefined;
      child.on("error", err => {
        spawnError = err;
      });
      child.on("close", (code, signal) => {
        this.children.delete(task);
        if (inherit) this.consoleEnd();
        done({
          code: code ?? 0,
          signal,
          spawnError,
          output: Buffer.concat(chunks).toString(),
          stdout: Buffer.concat(stdoutChunks).toString(),
        });
      });
    });
  }

  private extractDeps(task: Task, stdout: string): { deps?: string[]; filteredStdout?: string; error?: string } {
    const { spec } = task;
    const cwd = task.commands[0]?.cwd ?? this.buildDir;
    const toAbs = (p: string) => normalizePath(isAbsolute(p) ? p : resolve(cwd, p));
    if (spec.depfile!.kind === "msvc") {
      const { deps, filtered } = parseShowIncludes(stdout, spec.inputs?.[0]);
      return { deps: deps.map(toAbs), filteredStdout: filtered };
    }
    const path = this.abs(spec.depfile!.path);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (e) {
      return { error: `depfile ${this.rel(path)} could not be read: ${(e as Error).message}` };
    }
    const parsed = parseDepfile(text);
    const primary = spec.outputs[0]!;
    if (parsed.targets.length > 0 && !parsed.targets.some(t => toAbs(t) === primary)) {
      return { error: `depfile ${this.rel(path)} names '${parsed.targets[0]}', expected '${this.rel(primary)}'` };
    }
    // Folded into .build_deps; the file itself is not needed again.
    rmSync(path, { force: true });
    return { deps: parsed.deps.map(toAbs) };
  }

  // ─── Interrupt ───

  private interrupt(): void {
    if (this.interrupted) return;
    this.interrupted = true;
    this.jobsPool.abort();
    for (const p of this.pools.values()) p.abort();
    for (const [task, child] of this.children) {
      if (child.pid !== undefined) {
        try {
          if (this.opts.hostOs !== "windows" && task.spec.console !== true) process.kill(-child.pid, "SIGINT");
          else child.kill("SIGINT");
        } catch {}
      }
      // Drop outputs the interrupted command touched, and its depfile, so the
      // next build does not trust a half-written file. Same as ninja's Cleanup.
      const depfile = task.spec.depfile?.kind === "gcc" ? this.abs(task.spec.depfile.path) : undefined;
      for (const out of task.spec.outputs) {
        if (depfile !== undefined || this.stat(out) !== (this.mtimes.get(out) ?? 0)) rmSync(out, { force: true });
      }
      if (depfile !== undefined) rmSync(depfile, { force: true });
    }
  }

  // ─── Files ───

  private abs(p: string): string {
    return normalizePath(isAbsolute(p) ? p : resolve(this.buildDir, p));
  }

  private mtime(abs: string): number {
    let m = this.mtimes.get(abs);
    if (m === undefined) {
      m = this.stat(abs);
      this.mtimes.set(abs, m);
    }
    return m;
  }

  private stat(abs: string): number {
    const st = statSync(abs, { throwIfNoEntry: false });
    return st === undefined ? 0 : st.mtimeMs;
  }

  /** The file system's clock, so recorded start times compare with output mtimes. */
  private fsNow(): number {
    writeFileSync(this.lockPath, "");
    return this.stat(this.lockPath);
  }

  // ─── Output ───

  private explain(msg: string): void {
    if (this.opts.explain) process.stderr.write(`explain: ${msg}\n`);
  }

  private print(text: string, always = false): void {
    if (this.opts.display === "quiet" && !always) return;
    this.endStatusLine();
    process.stdout.write(text);
  }

  private endStatusLine(): void {
    if (this.statusLineActive) {
      process.stdout.write("\n");
      this.statusLineActive = false;
    }
  }

  private describe(task: Task): string {
    if (this.opts.verbose && !task.phony) return task.commands.map(commandText).join(" && ");
    return `${task.spec.kind} ${task.spec.label}`;
  }

  private statusText(task: Task): string {
    return `[${this.startedCount}/${this.planned}] ${this.describe(task)}`;
  }

  private statusStarted(task: Task): void {
    if (this.opts.display === "quiet") return;
    if (this.opts.display === "plain") {
      process.stdout.write(this.statusText(task) + "\n");
      return;
    }
    // A console job owns the terminal: no status line until it is done.
    if (this.consoleActive) return;
    process.stdout.write(`\r\x1b[K${this.statusText(task)}`);
    this.statusLineActive = true;
  }

  private statusFinished(task: Task, output: string): void {
    if (this.opts.display === "quiet") return;
    if (output.length === 0) {
      if (this.opts.display === "tty" && !this.consoleActive) {
        process.stdout.write(`\r\x1b[K${this.statusText(task)}`);
        this.statusLineActive = true;
      }
      return;
    }
    this.endStatusLine();
    if (this.opts.display === "tty") process.stdout.write(this.statusText(task) + "\n");
    process.stdout.write(output.endsWith("\n") ? output : output + "\n");
  }

  private reportFailure(task: Task, cmd: Command | undefined, output: string, why: string): void {
    this.endStatusLine();
    const text = cmd !== undefined ? commandText(cmd) + "\n" : "";
    process.stdout.write(`FAILED: ${task.spec.kind} ${task.spec.label} (${why})\n${text}${output}`);
    if (output.length > 0 && !output.endsWith("\n")) process.stdout.write("\n");
  }

  private consoleBegin(): void {
    this.endStatusLine();
    this.consoleActive = true;
  }

  private consoleEnd(): void {
    this.consoleActive = false;
  }
}

// ─── Helpers ───

/** A command as a human would type it. For logs and `-v`, not for execution. */
export function commandText(cmd: Command): string {
  let prefix = "";
  if (cmd.cwd !== undefined) prefix += `cd ${cmd.cwd} && `;
  for (const [k, v] of Object.entries(cmd.env ?? {})) prefix += `${k}=${shellQuote(v)} `;
  if ("shell" in cmd) return prefix + cmd.shell;
  return prefix + cmd.argv.map(shellQuote).join(" ");
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_+=:,./@%-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Collapse `a/./b` and `a/../b`. Drops a trailing separator. */
export function normalizePath(p: string): string {
  if (p.length === 0) return p;
  const norm = normalize(p);
  return norm.length > 1 && (norm.endsWith("/") || norm.endsWith("\\")) ? norm.slice(0, -1) : norm;
}

/** Split a raw command line into its program token and the verbatim remainder. */
export function splitProgram(command: string): { program: string; rest: string } {
  const trimmed = command.trimStart();
  if (trimmed.startsWith('"')) {
    const close = trimmed.indexOf('"', 1);
    if (close === -1) return { program: trimmed.slice(1), rest: "" };
    return { program: trimmed.slice(1, close), rest: trimmed.slice(close + 1).trimStart() };
  }
  const space = trimmed.search(/\s/);
  if (space === -1) return { program: trimmed, rest: "" };
  return { program: trimmed.slice(0, space), rest: trimmed.slice(space).trimStart() };
}
