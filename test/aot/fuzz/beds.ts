// The two ways a program is run plain and compiled.
//
//   product   `bun run` against `bun build --compile --aot`: the whole thing, host included. Bun's own library is compiled into every
//             executable, so a build takes seconds of several cores.
//   engine    the standalone front end, `testaot compile` and the `jsc` shell, against plain `jsc -m`: no host, a stand-in library,
//             half a second a program. JavaScript without imports only.
//
// A bed answers with what the program printed or with how the build or the run failed; compare() turns the two into a verdict.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { laterProbes, probeProgram, probes } from "./engine-probes";

export interface Program {
  text: string;
  extension: "js" | "ts";
}

export interface Run {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

export interface Compiled {
  build: Run;
  /** Absent when the build gave no executable. */
  run?: Run;
}

export interface Mode {
  name: string;
  flags: string[];
}

export type FindingKind =
  | "internal compiler error"
  | "build crash"
  | "build hang"
  | "build error"
  | "validation failure"
  | "crash"
  | "hang"
  | "different output"
  | "different exit code";

export interface Failure {
  kind: FindingKind;
  /** For people: the message, or the first line that differs. */
  detail: string;
  /** What a smaller program must keep to count as the same failure. */
  signature: string;
}

export type Verdict = { kind: "same" } | { kind: "skipped"; why: string } | Failure;

export const isFinding = (verdict: Verdict): verdict is Failure => verdict.kind !== "same" && verdict.kind !== "skipped";

export const sameFailure = (a: Failure, b: Verdict) => isFinding(b) && a.kind === b.kind && a.signature === b.signature;

export interface Judged {
  plain: Run;
  compiled?: Compiled;
  verdict: Verdict;
}

const environment: Record<string, string> = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME ?? "/tmp",
  BUN_ENABLE_CRASH_REPORTING: "0",
  DO_NOT_TRACK: "1",
  NO_COLOR: "1",
  BUN_DEBUG_QUIET_LOGS: "1",
  TZ: "Etc/UTC",
  CI: "1",
  BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
  BUN_GARBAGE_COLLECTOR_LEVEL: "0",
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  WTF_numberOfProcessorCores: "2",
};

/** For every process a bed starts from now on. As a user: without the flag that switches the compiler's verifiers on, so what they would refuse is built and run. */
export function changeEnvironment(more: Record<string, string>, asAUser: boolean) {
  Object.assign(environment, more);
  if (asAUser) delete environment.BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING;
}

const outputLimit = 1 << 20;

// A program that prints without end until its time is over prints gigabytes. What lies behind the limit is read and dropped: a slice of the whole text would keep the whole text alive.
async function textUpToTheLimit(stream: ReadableStream<Uint8Array>) {
  const kept: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    if (size < outputLimit) kept.push(chunk.slice(0, outputLimit - size));
    size += chunk.length;
  }
  return Buffer.concat(kept).toString();
}

export async function spawned(cmd: string[], cwd: string, seconds: number, more?: Record<string, string>): Promise<Run> {
  // No core files, and a limit on processor time and on memory behind the limit on wall time.
  const limited = ["/bin/sh", "-c", `ulimit -c 0; ulimit -t ${Math.ceil(seconds * 4)}; exec "$@"`, "--", ...cmd];
  await using child = Bun.spawn({ cmd: limited, cwd, env: { ...environment, ...more }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: seconds * 1000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([textUpToTheLimit(child.stdout), textUpToTheLimit(child.stderr), child.exited]);
  const timedOut = child.signalCode === "SIGKILL" || child.signalCode === "SIGXCPU";
  return { stdout, stderr, exitCode: child.signalCode ? null : exitCode, signal: timedOut || child.signalCode === null ? null : String(child.signalCode), timedOut };
}

export interface Bed {
  readonly name: string;
  /** What identifies the binaries, for the records. */
  readonly binary: string;
  /** Whether the bed may be given the program at all. */
  accepts(program: Program): boolean;
  /** Whether everything in the text works on the bed as it does in plain JavaScript. */
  allows(text: string): boolean;
  modes(program: Program): Mode[];
  /** The mode whose result tells a false proof from another bug. */
  withoutFlowResults: string[];
  /** Flags that switch off the given passes and flow results. */
  disabling(names: string[]): string[];
  /** Every pass and flow result that can be switched off. */
  switches(): Promise<{ flowResults: string[]; passes: string[] }>;
  /** How many programs one call of judge() takes well. */
  readonly batch: number;
  /** Runs each program plain and compiled. One program is built by itself; several may share a build. */
  judge(folder: string, programs: Program[], flags: string[]): Promise<Judged[]>;
  /** Writes the files of a build that several programs share, as judge() builds them, and answers with the commands that build and run the first one. */
  store?(folder: string, programs: Program[], flags: string[]): string;
}

async function inParallel<T, R>(items: T[], width: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index], index);
      }
    }),
  );
  return results;
}

function unusable(bed: Bed, plain: Run): Verdict | undefined {
  if (plain.timedOut) return { kind: "skipped", why: "plain run too slow" };
  if (plain.signal) return { kind: "skipped", why: "plain run crashed" };
  // The shell reports an uncaught exception of a module in other words than that of a compiled entry point.
  if (bed.name === "engine" && plain.exitCode !== 0) return { kind: "skipped", why: "uncaught exception" };
}

/** In front of a flag that is no flag of the build: a variable for the run of the executable. */
const inTheRun = "--in-the-run=";

export class ProductBed implements Bed {
  readonly name = "product";
  readonly binary: string;
  readonly batch = 64;
  withoutFlowResults = ["--aot-disable=flow-results"];
  #switches?: { flowResults: string[]; passes: string[] };

  constructor(
    readonly bun: string,
    readonly options: {
      baseFlags: string[];
      validate: boolean;
      threads: number;
      buildSeconds: number;
      runSeconds: number;
      /** The executable's time, where it is not the plain run's: a collection at every few allocations takes long. */
      compiledRunSeconds?: number;
      /** For the run of the executable alone. */
      runEnvironment?: Record<string, string>;
      /** Only these modes. */
      modes?: string[];
      /** The executable runs with a collection at every n-th allocation that leaves the fast path, n drawn from these, full or young; freed cells are overwritten and never reused. */
      collectorStress?: number[];
      /** So many workers run the program at once, each for itself, in place of the main thread. */
      workers?: number;
    },
  ) {
    this.binary = bun.split("/").pop()!;
  }

  accepts() {
    return true;
  }

  allows() {
    return true;
  }

  // Several --aot-disable flags do not add up, so the lists are merged into one flag.
  #merged(flags: string[]): string[] {
    const disabled = flags.filter(flag => flag.startsWith("--aot-disable=")).flatMap(flag => flag.slice("--aot-disable=".length).split(","));
    const rest = flags.filter(flag => !flag.startsWith("--aot-disable="));
    return disabled.length ? [...rest, "--aot-disable=" + [...new Set(disabled)].join(",")] : rest;
  }

  // One interval is blind to what another sees, so each batch gets its own. The draw rides in the flags of the mode: what confirms and reduces a finding runs under the same one, and the finding records it.
  #drawnStress(): string[] {
    const intervals = this.options.collectorStress;
    if (!intervals?.length) return [];
    const drawn = Math.floor(Math.random() * intervals.length * 2);
    const set = [`BUN_JSC_slowPathAllocsBetweenGCs=${intervals[drawn >> 1]}`, "BUN_JSC_scribbleFreeCells=1", "BUN_JSC_useZombieMode=1", ...(drawn & 1 ? ["BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1"] : [])];
    return set.map(each => inTheRun + each);
  }

  modes(program: Program): Mode[] {
    const stress = this.#drawnStress();
    return this.#modes(program).map(mode => ({ ...mode, flags: [...mode.flags, ...stress] }));
  }

  #modes(program: Program): Mode[] {
    const modes: Mode[] = [{ name: "default", flags: [] }];
    if (this.options.validate) modes.push({ name: "validate", flags: ["--aot-validate"] });
    // The product's own code with its proofs asked again at run time: a false proof is a named stop where the default build answers wrongly in silence.
    if (this.options.validate) modes.push({ name: "proofs-checked", flags: ["--aot-testing=CheckProofsAtRunTime"] });
    if (program.extension === "ts") modes.push({ name: "erased", flags: ["--aot-erase-types"] });
    // How hot a function counts goes by the whole program, and a small program is mostly lukewarm: little is inlined, so the passes behind inlining see little.
    // One fault showed only where three other modules were built beside the program. They did nothing but move its heat.
    modes.push({ name: "every-function-hot", flags: ["--aot-heat=everything-is-hot"] });
    if (!this.options.modes) return modes;
    // Asked for by name only.
    if (program.extension === "ts") modes.push({ name: "erased-and-hot", flags: ["--aot-erase-types", "--aot-heat=everything-is-hot"] });
    modes.push({ name: "nothing-inlined", flags: ["--aot-disable=InlineCalls"] });
    modes.push({ name: "hot-and-nothing-inlined", flags: ["--aot-heat=everything-is-hot", "--aot-disable=InlineCalls"] });
    modes.push({ name: "no-flow-results", flags: ["--aot-disable=flow-results"] });
    modes.push({ name: "hot-without-flow-results", flags: ["--aot-heat=everything-is-hot", "--aot-disable=flow-results"] });
    return modes.filter(mode => this.options.modes!.includes(mode.name));
  }

  disabling(names: string[]) {
    return names.length ? ["--aot-disable=" + names.join(",")] : [];
  }

  async switches() {
    if (this.#switches) return this.#switches;
    const folder = join(process.env.TMPDIR ?? "/tmp", `aot-fuzz-registry-${process.pid}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "empty.js"), "");
    const listed = await spawned([this.bun, "build", "--compile", "--aot", "empty.js", "--outfile", "empty", "--aot-list=registry"], folder, 120);
    rmSync(folder, { recursive: true, force: true });
    const registry = JSON.parse((listed.stdout + listed.stderr).split("\n").find(line => line.startsWith("{"))!);
    const names = (list: any[]) => list.map(entry => (typeof entry === "string" ? entry : entry.name) as string);
    return (this.#switches = {
      // A bare name may stand for two things, and the build refuses it then.
      passes: names(registry.passes.filter((pass: any) => pass.isOptional)).map(name => "pass:" + name),
      flowResults: names(registry.flowResults).map(name => "flow:" + name),
    });
  }

  #write(folder: string, file: string, program: Program) {
    const print = program.extension === "ts" ? "function print(text: string): void {\n  console.log(text);\n}\n" : "function print(text) {\n  console.log(text);\n}\n";
    writeFileSync(join(folder, file), /\bprint\(/.test(program.text) && !/\b(function|const|let|var) print\b/.test(program.text) ? print + program.text : program.text);
    if (program.extension === "ts" && !existsSync(join(folder, "tsconfig.json")))
      writeFileSync(join(folder, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", allowJs: true, noEmit: true, strict: true, types: [] } }));
  }

  #run(folder: string, cmd: string[], flags: string[]) {
    const drawn = flags.filter(flag => flag.startsWith(inTheRun)).map(flag => flag.slice(inTheRun.length).split("="));
    return spawned(cmd, folder, this.options.compiledRunSeconds ?? this.options.runSeconds, { ...this.options.runEnvironment, ...Object.fromEntries(drawn) });
  }

  #build(folder: string, entry: string, flags: string[]) {
    const all = this.#merged([...this.options.baseFlags, ...flags]).filter(flag => !flag.startsWith(inTheRun));
    return spawned([this.bun, "build", "--compile", "--aot", `--aot-threads=${this.options.threads}`, ...all, entry, "--outfile", join(folder, "executable")], folder, this.options.buildSeconds);
  }

  async judge(folder: string, programs: Program[], flags: string[]): Promise<Judged[]> {
    const executable = join(folder, "executable");
    try {
      if (programs.length !== 1 || this.options.workers) return await this.#judgeTogether(folder, programs, flags);
      const [program] = programs;
      const file = "program." + program.extension;
      this.#write(folder, file, program);
      const plain = await spawned([this.bun, "run", file], folder, this.options.runSeconds);
      const early = unusable(this, plain);
      if (early) return [{ plain, verdict: early }];
      rmSync(executable, { force: true });
      const build = await this.#build(folder, file, flags);
      const compiled: Compiled = existsSync(executable) && build.exitCode === 0 ? { build, run: await this.#run(folder, [executable], flags) } : { build };
      return [{ plain, compiled, verdict: compare(this, program, plain, compiled) }];
    } finally {
      rmSync(executable, { force: true });
    }
  }

  #writeModules(folder: string, programs: Program[]) {
    // A file without `import` or `export` is a script to the checker, and two scripts share their top-level names.
    programs.forEach((program, index) => this.#write(folder, `p${index}.${program.extension}`, /^(import|export)\b/m.test(program.text) ? program : { ...program, text: program.text + "\nexport {};\n" }));
  }

  #writeEntryPoint(folder: string, programs: Program[], members: number[]) {
    const table = `const programs = {\n${members.map(index => `  ${index}: () => import("./p${index}.${programs[index].extension}"),\n`).join("")}};\n`;
    if (!this.options.workers) return writeFileSync(join(folder, "main.js"), `${table}await programs[process.argv[2]]();\n`);
    writeFileSync(
      join(folder, "main.js"),
      `import { isMainThread, Worker, workerData } from "node:worker_threads";
${table}if (isMainThread) {
  const ends = [];
  for (let i = 0; i < ${this.options.workers}; i++) {
    const worker = new Worker(import.meta.url, { workerData: process.argv[2] });
    ends.push(new Promise(resolve => worker.on("error", error => console.log("a worker ended with " + error?.name)).on("exit", resolve)));
  }
  console.log("exit codes " + (await Promise.all(ends)).join(" "));
} else await programs[workerData]();
`,
    );
  }

  // Threads print in whatever order they get to it. Every line has to be there as often as in plain Bun.
  #inAnyOrder(run: Run): Run {
    return this.options.workers ? { ...run, stdout: run.stdout.split("\n").sort().join("\n") } : run;
  }

  store(folder: string, programs: Program[], flags: string[]) {
    this.#writeModules(folder, programs);
    this.#writeEntryPoint(folder, programs, programs.map((_, index) => index)); // prettier-ignore
    const [inRun, inBuild] = [true, false].map(wanted => this.#merged([...this.options.baseFlags, ...flags]).filter(flag => flag.startsWith(inTheRun) === wanted));
    return `bun run main.js 0\nbun ${["build", "--compile", "--aot", ...inBuild, "main.js", "--outfile", "executable"].join(" ")} && ${inRun.map(flag => flag.slice(inTheRun.length) + " ").join("")}./executable 0\n`;
  }

  // One build holds every program as a module of its own, and an argument says which one a run imports: Bun's own library is
  // compiled once for all of them, and no run sees what another did. What the compiler proves, it proves about all of them at once.
  async #judgeTogether(folder: string, programs: Program[], flags: string[]): Promise<Judged[]> {
    const executable = join(folder, "executable");
    const results = new Array<Judged>(programs.length);
    const entry = (members: number[]) => this.#writeEntryPoint(folder, programs, members);
    const all = programs.map((_, index) => index);
    this.#writeModules(folder, programs);
    entry(all);
    const plains = (await inParallel(all, 4, index => spawned([this.bun, "run", "main.js", String(index)], folder, this.options.runSeconds))).map(run => this.#inAnyOrder(run));
    for (const index of all) {
      const early = unusable(this, plains[index]);
      if (early) results[index] = { plain: plains[index], verdict: early };
    }

    const together = async (members: number[]): Promise<void> => {
      if (!members.length) return;
      entry(members);
      rmSync(executable, { force: true });
      const build = await this.#build(folder, "main.js", flags);
      if (existsSync(executable) && build.exitCode === 0) {
        const runs = (await inParallel(members, 4, index => this.#run(folder, [executable, String(index)], flags))).map(run => this.#inAnyOrder(run));
        members.forEach((index, at) => {
          const compiled = { build, run: runs[at] };
          results[index] = { plain: plains[index], compiled, verdict: compare(this, programs[index], plains[index], compiled) };
        });
        return;
      }
      // Whose fault is it? An error names a file; what names none is searched for by halves.
      const blamed = new Map<number, string>();
      for (const record of (build.stderr + "\n" + build.stdout).split(/\n(?=error\b)/)) {
        if (!record.startsWith("error")) continue;
        const named = /\bp(\d+)\.(?:js|ts)\b/.exec(record.split(/\n\s*\n/)[0]);
        if (named && members.includes(Number(named[1])) && !blamed.has(Number(named[1]))) blamed.set(Number(named[1]), record.split(/\n\s*\n/)[0]);
      }
      if (members.length === 1 || blamed.size) {
        for (const index of blamed.size ? blamed.keys() : members) {
          const compiled = { build: blamed.size ? { ...build, stdout: "", stderr: blamed.get(index)! } : build };
          results[index] = { plain: plains[index], compiled, verdict: compare(this, programs[index], plains[index], compiled) };
        }
        return together(members.filter(index => !results[index]));
      }
      await together(members.slice(0, members.length >> 1));
      await together(members.slice(members.length >> 1));
    };
    await together(all.filter(index => !results[index]));
    for (const index of all) rmSync(join(folder, `p${index}.${programs[index].extension}`), { force: true });
    return results;
  }
}

// `console` for the shell, which has none: the programs of test/aot/programs print through it. Loops and natives only.
const shellConsole = `function consoleText(value, depth) {
  if (typeof value === "string") return depth ? JSON.stringify(value) : value;
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "[function " + value.name + "]";
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 3) return "..";
  let text = "";
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && i < 100; i++) text += (i ? ", " : "") + (i in value ? consoleText(value[i], depth + 1) : "hole");
    return "[" + text + "]";
  }
  if (value instanceof Error) return value.name + ": " + value.message;
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) text += (i ? ", " : "") + keys[i] + ": " + consoleText(value[keys[i]], depth + 1);
  return "{" + text + "}";
}
function consoleLine() {
  let text = "";
  for (let i = 0; i < arguments.length; i++) text += (i ? " " : "") + consoleText(arguments[i], 0);
  print(text);
}
const console = { log: consoleLine, error: consoleLine, warn: consoleLine, info: consoleLine, debug: consoleLine };
`;

export class EngineBed implements Bed {
  readonly name = "engine";
  readonly binary: string;
  readonly batch = 1;
  withoutFlowResults = ["disable=flow-results"];
  #switches?: { flowResults: string[]; passes: string[] };
  #lowered = new Map<string, string>();
  #missing = /(?!)/;

  /** `tools` holds `fe` (the standalone front end), `testaot` and `jsc`. */
  constructor(
    readonly tools: string,
    readonly options: { baseFlags: string[]; validate: boolean; buildSeconds: number; runSeconds: number },
  ) {
    this.binary = "testaot-" + (existsSync(join(tools, "stamp")) ? readFileSync(join(tools, "stamp"), "utf8").trim() : tools.split("/").pop());
  }

  // The shell has no host, and calling a built-in of the host there is not defined.
  accepts(program: Program) {
    return program.extension === "js" && !/\b(import|require|Bun|process|setTimeout|setInterval|setImmediate|queueMicrotask|structuredClone|Buffer|fetch|Response|Request|Headers|URL|URLSearchParams|TextEncoder|TextDecoder|performance|navigator|crypto|AbortController|Blob|Worker|WebSocket|EventTarget|Event|alert|prompt|confirm|BroadcastChannel|MessageChannel|atob|btoa|reportError|self|Intl|WebAssembly|gc|noInline)\b/.test(program.text); // prettier-ignore
  }

  // For a built-in that is written in JavaScript a stand-in answers undefined: prepare() finds out which.
  allows(text: string) {
    return this.accepts({ text, extension: "js" }) && !this.#missing.test(text);
  }

  /** Asks the bed what it can do. To be called once before allows(). Returns the patterns of what it cannot. */
  async prepare(folder: string): Promise<string[]> {
    mkdirSync(folder, { recursive: true });
    const all = [...probes, ...laterProbes];
    const missing = new Set<string>();
    // Ten at a time; where the ten do not all answer as in plain JavaScript, one at a time, because a crash silences the rest.
    const ask = async (groups: number[][]) => {
      const judged = await this.judge(folder, groups.map(numbers => ({ text: probeProgram(numbers), extension: "js" })), []);
      return groups.filter((_, index) => judged[index].verdict.kind !== "same");
    };
    const tens = Array.from({ length: Math.ceil(all.length / 10) }, (_, index) => all.map((_, number) => number).slice(index * 10, index * 10 + 10));
    for (const [number] of await ask((await ask(tens)).flat().map(number => [number]))) missing.add(all[number][0]);
    this.#missing = missing.size ? new RegExp([...missing].join("|")) : /(?!)/;
    return [...missing];
  }

  modes(): Mode[] {
    const modes: Mode[] = [{ name: "default", flags: [] }];
    if (this.options.validate) modes.push({ name: "validate", flags: ["validate"] });
    return modes;
  }

  disabling(names: string[]) {
    return names.length ? ["disable=" + names.join(",")] : [];
  }

  async switches() {
    if (this.#switches) return this.#switches;
    const listed = await spawned([join(this.tools, "testaot"), "list", "options"], this.tools, 60);
    const names = listed.stdout.split("\n").map(line => line.trim());
    return (this.#switches = { flowResults: names.filter(name => name.startsWith("flow:")), passes: names.filter(name => name.startsWith("pass:")) });
  }

  judge(folder: string, programs: Program[], flags: string[]): Promise<Judged[]> {
    return inParallel(programs, 3, async (program, index) => {
      const own = programs.length === 1 ? folder : join(folder, `c${index % 3}`);
      mkdirSync(own, { recursive: true });
      writeFileSync(join(own, "program.js"), (/\bconsole\b/.test(program.text) ? shellConsole : "") + program.text);
      const plain = await spawned([join(this.tools, "jsc"), "-m", "program.js"], own, this.options.runSeconds);
      const early = unusable(this, plain);
      if (early) return { plain, verdict: early };
      const compiled = await this.#compiled(own, program, flags);
      return { plain, compiled, verdict: compare(this, program, plain, compiled) };
    });
  }

  async #compiled(folder: string, program: Program, flags: string[]): Promise<Compiled> {
    const text = join(folder, "program.ir");
    const image = join(folder, "program.image");
    if (this.#lowered.get(folder) !== program.text) {
      this.#lowered.delete(folder);
      const lowered = await spawned([join(this.tools, "fe"), "compile", "program.js", `--aot-out=${text}`, "--text", "--aot-threads=2", "--no-builtin-modules"], folder, this.options.buildSeconds);
      if (lowered.exitCode !== 0 || !existsSync(text)) return { build: { ...lowered, stderr: "front end: " + lowered.stderr + lowered.stdout } };
      writeFileSync(text, adapted(readFileSync(text, "utf8")));
      this.#lowered.set(folder, program.text);
    }
    try {
      const disabled = [...this.options.baseFlags, ...flags].filter(flag => flag.startsWith("disable=")).flatMap(flag => flag.slice("disable=".length).split(","));
      const rest = [...this.options.baseFlags, ...flags].filter(flag => !flag.startsWith("disable="));
      const build = await spawned([join(this.tools, "testaot"), "compile", text, `--output=${image}`, ...rest, ...(disabled.length ? ["disable=" + disabled.join(",")] : [])], folder, this.options.buildSeconds);
      const entry = /^entry \S+ (\S+)/m.exec(build.stdout)?.[1];
      if (build.exitCode !== 0 || !entry) return { build: { ...build, stderr: build.stderr + build.stdout.replace(/^(entry|loss).*\n/gm, "") } };
      return { build, run: await spawned([join(this.tools, "jsc"), `--aotImagePath=${image}`, "-e", `runCompiledEntryPoint(${entry}); drainMicrotasks()`], folder, this.options.runSeconds) };
    } finally {
      rmSync(image, { force: true });
    }
  }
}

// The front end at hand may be older or newer than testaot. The ids of the host's library functions move whenever the table of
// built-ins changes: without these lines every library function is the stand-in. A front end from before `DefineMethod .. index=N`
// leaves the index out: one counter per class object, 0 not written.
function adapted(text: string): string {
  const lines = text.split("\n").filter(line => !line.startsWith("runtimefunction "));
  if (lines.some(line => line.trimStart().startsWith("DefineMethod ") && line.includes(" index="))) return lines.join("\n");
  let counts = new Map<string, number>();
  return lines
    .map(line => {
      if (line.startsWith("function ")) counts = new Map();
      const row = /^(\s+DefineMethod (v\d+),[^@]*?)( key=.*| @\d+.*|)$/.exec(line);
      if (!row) return line;
      const index = counts.get(row[2]) ?? 0;
      counts.set(row[2], index + 1);
      return index ? `${row[1].trimEnd()} index=${index}${row[3]}` : line;
    })
    .join("\n");
}

/** Numbers, names and paths out of a message, so that two reports of one cause read the same. */
export function normalized(text: string): string {
  return text
    .replace(/\/[\w./$-]+\/([\w.-]+)/g, "$1")
    .replace(/'[^']*'/g, "'_'")
    .replace(/"[^"]*"/g, '"_"')
    .replace(/\b(f|b|v)\d+\b/g, "$1N")
    .replace(/0x[0-9a-fA-F]+/g, "0xN")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

// The line that names an uncaught error: on stderr in Bun, on stdout in the shell.
const uncaught = (run: Run) => (run.stderr + "\n" + run.stdout).split("\n").find(line => /^(error|Exception|[A-Za-z]*Error)\b/.test(line)) ?? "";

const validationMessage = /^.*(AOT validation|validation failed).*$/m;

export function compare(bed: Bed, program: Program, plain: Run, compiled: Compiled): Verdict {
  const failure = (kind: FindingKind, detail: string, signature = detail): Failure => ({ kind, detail, signature });
  const { build, run } = compiled;
  const said = build.stderr + "\n" + build.stdout;
  if (!run) {
    if (build.timedOut) return failure("build hang", "");
    // The first line may only say that the program is not valid at the end; the lines after it say what is wrong.
    const internal = said.match(/^.*internal compiler error.*$/gm);
    if (internal) return failure("internal compiler error", normalized((internal.find(line => !line.includes("VerificationFailedAtTheEnd")) ?? internal[0]).replace(/;? (in )?function .*$/, "")));
    if (build.signal || /\bpanic(ked)?\b|ASSERTION FAILED|SHOULD NEVER BE REACHED|Segmentation fault/.test(said))
      return failure("build crash", `${build.signal ?? ""} ${normalized(/^.*(panic|ASSERTION FAILED|SHOULD NEVER BE REACHED|Segmentation fault|AOT: ).*$/m.exec(said)?.[0] ?? "")}`.trim());
    // A mutant of a typed program may not type-check, and that stops a build.
    if (program.extension === "ts" && /\berror: TS\d+/.test(said)) return { kind: "skipped", why: "type error" };
    const error = /^(front end: )?.*\berror\b.*$/im.exec(said)?.[0] ?? said.trim().split("\n")[0] ?? "";
    // testaot reports what the product calls an internal compiler error as `<Name>: <what it means>; function ..`.
    if (bed.name === "engine" && /^[A-Z][A-Za-z]+: /.test(said.trim())) return failure("internal compiler error", normalized(said.trim().split("\n")[0].replace(/; function .*$/, "")));
    return failure("build error", normalized(error));
  }
  const invalid = validationMessage.exec(run.stderr + "\n" + run.stdout);
  if (invalid && !validationMessage.test(plain.stderr + "\n" + plain.stdout)) return failure("validation failure", invalid[0].slice(0, 200), normalized(invalid[0]));
  if (run.signal) return failure("crash", `${run.signal} ${normalized(/^.*(panic|ASSERTION FAILED|SHOULD NEVER BE REACHED|Segmentation fault|AOT: ).*$/m.exec(run.stderr)?.[0] ?? "")}`.trim());
  if (run.timedOut) return failure("hang", "");
  if (run.stdout === plain.stdout && run.exitCode === plain.exitCode) return { kind: "same" };
  const exits = run.exitCode === plain.exitCode ? "" : ` | exit codes ${plain.exitCode} ${run.exitCode}: ${uncaught(run.exitCode ? run : plain).slice(0, 160)}`;
  const codes = `${plain.exitCode} ${run.exitCode} ${normalized(uncaught(run.exitCode ? run : plain))}`;
  if (run.stdout === plain.stdout) return failure("different exit code", exits.slice(3), codes);
  const [ours, theirs] = [run.stdout.split("\n"), plain.stdout.split("\n")];
  const line = ours.findIndex((text, index) => text !== theirs[index]);
  const at = line < 0 ? ours.length : line;
  // A smaller program has to differ at the same place: else a reduction wanders off to whatever difference is cheapest to keep. The first word of a line is its label in most programs.
  const label = (text: string | undefined) => /^\S*/.exec(text ?? "<end>")![0].slice(0, 40);
  const signature = run.exitCode === plain.exitCode ? `values ${label(theirs[at])} ${label(ours[at])}` : codes;
  const overflowed = [theirs[at], ours[at]].some(text => text?.includes("Maximum call stack size exceeded")) ? " | the line tells of a stack overflow" : "";
  return failure("different output", `plain ${JSON.stringify((theirs[at] ?? "<end>").slice(0, 120))} compiled ${JSON.stringify((ours[at] ?? "<end>").slice(0, 120))}${exits}${overflowed}`, signature);
}
