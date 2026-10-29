// The two ways to run a program both plain and compiled.
//
//   product   `bun run` against `bun build --compile --aot`: the real thing, host included. Bun's own library is compiled into every
//             executable, so a build takes seconds on several cores.
//   engine    the standalone front end, `testaot compile` and the `jsc` shell, against plain `jsc -m`: no host, a stand-in library,
//             half a second per program. Only JavaScript without imports.
//
// A runner returns what the program printed, or how the build or the run failed; compare() turns the two results into a
// verdict. A program is one text, or a text plus the files it imports: the product runner writes those into their own
// folder.
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { limitsLowered } from "../harness/limits";
import { endAtMemoryLimit, memoryLimit } from "../harness/memory-limit";
import { withoutInstallingPackages } from "../harness/without-installing-packages";
import { decoyShapes, memberNames } from "./decoy-shapes";
import { laterProbes, probeProgram, probes } from "./engine-probes";
import { bunInitCompilerOptions, typeChecker, bunTypesFolder, type Checker } from "./type-check";

export interface Program {
  text: string;
  extension: "js" | "ts" | "mjs" | "cjs" | "mts" | "cts" | "jsx" | "tsx";
  /**
   * Its other files, by path relative to its folder. The program then has its own folder, where `text` is
   * `main.<extension>`.
   */
  files?: Record<string, string>;
  /** Extra flags for every build of it. */
  flags?: string[];
  /** Environment of the plain Bun run only. Such a program gets its own build. */
  plainEnvironment?: Record<string, string>;
  /** The members of `files` that are passed to the build as extra entry points, for files loaded by a computed name. */
  entryPoints?: string[];
  /**
   * It has `files`, and both runs and the build start in its folder, so its tsconfig.json also applies to `bun run` and
   * relative paths resolve from there.
   */
  runsInOwnFolder?: true;
  /**
   * Why the two runs may print these two texts, when the source knows of an intended difference that only shows in the
   * output. Such a program counts as skipped.
   */
  meant?: (plain: string, compiled: string) => string | undefined;
  /**
   * It has a `plainEnvironment`, and without it plain Bun's output differs from run to run: an executable is right if
   * it prints what one of forty such runs prints.
   */
  unstablePlainOutput?: string;
  /**
   * It is built with its own compiler options, which TypeScript is not run with here: a build that stops at an error in
   * the program is not a finding.
   */
  mayBeRefused?: true;
}

export interface Run {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** It was killed for using more memory than allowed. `timedOut` is set as well. */
  ranOutOfMemory?: boolean;
}

export interface Compiled {
  build: Run;
  /** Absent if the build produced no executable. */
  run?: Run;
}

export interface Mode {
  name: string;
  flags: string[];
  /** For a program that has its own build, this mode repeats another one. */
  isForSharedBuilds?: true;
}

export type FindingKind =
  | "internal compiler error"
  | "build crash"
  | "build hang"
  | "build error"
  | "build refused"
  | "validation failure"
  | "crash"
  | "hang"
  | "different output"
  | "different exit code";

export interface Failure {
  kind: FindingKind;
  /** For people: the message, or the first line that differs. */
  detail: string;
  /** What a reduced program must keep to count as the same failure. */
  signature: string;
}

export type Verdict =
  | { kind: "same" }
  | { kind: "skipped"; why: string; /** The words of a type error that stopped the build. */ refusal?: string }
  | Failure;

/** All of the program's source text. */
export const wholeText = (program: Pick<Program, "text" | "files">) =>
  [program.text, ...Object.values(program.files ?? {})].join("\n");

/** The program's entry point, relative to its build folder. */
export const entryOf = (stem: string, program: Program) =>
  program.files ? `${stem}/main.${program.extension}` : `${stem}.${program.extension}`;

/** One file `<stem>.<extension>`, or a folder `<stem>`. */
export function writeProgram(folder: string, stem: string, program: Program) {
  rmSync(join(folder, stem), { recursive: true, force: true });
  for (const [path, text] of Object.entries({ ...program.files, [entryOf(stem, program)]: program.text })) {
    const file = path === entryOf(stem, program) ? join(folder, path) : join(folder, stem, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

export const isFinding = (verdict: Verdict): verdict is Failure =>
  verdict.kind !== "same" && verdict.kind !== "skipped";

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
  // Every Bun we start exits when we do.
  BUN_FEATURE_FLAG_NO_ORPHANS: "1",
};

/**
 * Applies to every process a runner starts from now on. `noVerifiers` removes the flag that turns the compiler's
 * verifiers on, as in a user's build.
 */
export function changeEnvironment(more: Record<string, string>, noVerifiers: boolean) {
  for (const [name, value] of Object.entries(more)) {
    if (value === "") delete environment[name];
    else environment[name] = value;
  }
  if (noVerifiers) delete environment.BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING;
}

const outputLimit = 1 << 20;

// A program that prints until its time limit prints gigabytes. Output past the limit is read and dropped; slicing the
// whole text would keep all of it alive.
async function truncatedText(stream: ReadableStream<Uint8Array>) {
  const kept: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    if (size < outputLimit) kept.push(chunk.slice(0, outputLimit - size));
    size += chunk.length;
  }
  return Buffer.concat(kept).toString();
}

// A PID namespace does not change the process group: kill(0) goes to the group the program was started in. So it also
// gets its own session, and with it its own group.
const isolationCommand = ["unshare", "--user", "--map-current-user", "--pid", "--fork", "--kill-child", "--", "setsid"];
let isolationWorks: boolean | undefined;
/**
 * Whether a command can run in its own PID namespace here: Linux, `unshare` from util-linux, and a kernel that allows
 * unprivileged user namespaces. Checked once.
 */
export function canIsolate(): boolean {
  return (isolationWorks ??=
    process.platform === "linux" &&
    !!Bun.which("unshare") &&
    !!Bun.which("setsid") &&
    Bun.spawnSync({ cmd: [...isolationCommand, "true"], stdio: ["ignore", "ignore", "ignore"] }).exitCode === 0);
}
/**
 * `apart`: the command runs a generated program. Where possible it gets its own PID namespace and process group: it is
 * PID 1 and sees no other process, so kill(0), kill(-1) and a PID that a mutation or a wrong answer made up can only
 * hit the program itself. PID 1 is not killed by a signal it sends itself and does not handle; that is the same for
 * plain and compiled.
 */
export async function spawned(
  cmd: string[],
  cwd: string,
  seconds: number,
  more?: Record<string, string>,
  memory = memoryLimit,
  apart = false,
): Promise<Run> {
  const isIsolated = apart && canIsolate();
  if (isIsolated) cmd = [...isolationCommand, ...cmd];
  // No core files, and a CPU time limit as a backstop for the wall-clock limit. Where core files are piped to a
  // program, Linux ignores every limit except one byte, which disables the pipe. If the machine still runs out of
  // memory, Linux kills this process first.
  const oomScoreAdjust = process.platform === "linux" ? "{ echo 1000 > /proc/$$/oom_score_adj; } 2> /dev/null; " : "";
  const limited =
    process.platform === "win32"
      ? cmd
      : [
          "/bin/sh",
          "-c",
          `${oomScoreAdjust}prlimit --pid $$ --core=1:1 2> /dev/null || ulimit -c 0; ulimit -t ${Math.ceil(seconds * 4)}; exec "$@"`,
          "--",
          ...cmd,
        ];
  await using child = Bun.spawn({
    cmd: limited,
    cwd,
    env: { ...environment, ...more },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: seconds * 1000,
    killSignal: "SIGKILL",
  });
  // `unshare` wraps an isolated command: the child it starts is what is measured, and killing it kills the child.
  using held = endAtMemoryLimit(child, memory, false, isIsolated);
  const [stdout, stderr, exitCode] = await Promise.all([
    truncatedText(child.stdout),
    truncatedText(child.stderr),
    child.exited,
  ]);
  const timedOut = child.signalCode === "SIGKILL" || child.signalCode === "SIGXCPU";
  return {
    stdout,
    stderr,
    exitCode: child.signalCode ? null : exitCode,
    signal: timedOut || child.signalCode === null ? null : String(child.signalCode),
    timedOut,
    ranOutOfMemory: held.exceeded,
  };
}

export interface Runner {
  readonly name: string;
  /** Identifies the binaries, for the records. */
  readonly binary: string;
  /** Whether the runner can take the program at all. */
  accepts(program: Program): boolean;
  /** Whether everything in the text works on the runner as in plain JavaScript. */
  allows(text: string): boolean;
  modes(program: Program): Mode[];
  /** The mode whose result separates a false proof from other bugs. */
  withoutFlowResults: string[];
  /** Flags that turn off the given passes and flow results. */
  disabling(names: string[]): string[];
  /** Flags for an executable built without the compiler, if the runner can build one. */
  withoutCompiler?: string[];
  /** Every pass and flow result that can be turned off. */
  switches(): Promise<{ flowResults: string[]; passes: string[] }>;
  /** How many programs one call of judge() handles well. */
  readonly batch: number;
  /** Whether a program can have its own build, as the entry point. */
  readonly supportsOwnBuild?: boolean;
  /** Whether a program may have `files`. */
  readonly supportsMultiFile?: boolean;
  /**
   * After this time, a shared build that fails is no longer bisected to find the culprit: every program in it gets the
   * verdict.
   */
  lastCall?: number;
  /** Runs each program plain and compiled. One program gets its own build; several may share one. */
  judge(folder: string, programs: Program[], flags: string[]): Promise<Judged[]>;
  /**
   * Writes the files of a shared build the way judge() does, and returns the commands that build it and run the first
   * program.
   */
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

function unusable(runner: Runner, plain: Run): Verdict | undefined {
  if (plain.timedOut)
    return { kind: "skipped", why: plain.ranOutOfMemory ? "plain run takes too much memory" : "plain run too slow" };
  // Plain Bun is the same binary, so a crash there is a finding too.
  if (plain.signal) {
    const said =
      plain.stderr.split("\n").find(line => /panic|Segmentation|Illegal|Trap|ASSERT|AddressSanitizer/.test(line)) ?? "";
    return {
      kind: "crash",
      detail: `plain Bun died of ${plain.signal}: ${said.slice(0, 160)}`,
      signature: `plain ${plain.signal}`,
    };
  }
  // The shell reports a module's uncaught exception in different words than a compiled entry point's.
  if (runner.name === "engine" && plain.exitCode !== 0) return { kind: "skipped", why: "uncaught exception" };
}

/** Prefix of a flag that is not a build flag: an environment variable for the executable's run. */
export const runEnvFlag = "--run-env=";
/** Turns on every run-time check in an executable, however it was built. */
export const runtimeChecksVariable = "BUN_JSC_validateAOTRuntime=1";
/**
 * Also not a build flag: how many decoy shapes with the programs' property names are built beside them
 * (decoy-shapes.ts).
 */
const decoyShapesFlag = "--decoy-shapes=";
/** Also not a build flag: which project files lie in the build folder, a key of `projects`. */
const projectFlag = "--project=";
/**
 * Also not a build flag: each program of a shared build is a separate entry point, so the compiler treats each one as
 * it would alone.
 */
const separateEntryPointsFlag = "--separate-entry-points";
const withoutCompilerFlag = "--without-aot";
export const scriptMarker = "// stays a script\n";
/** Functions that a program may call without declaring them. */
export const printFor = (isTyped: boolean) =>
  isTyped
    ? "function print(text: string): void {\n  console.log(text);\n}\n"
    : "function print(text) {\n  console.log(text);\n}\n";

/** Each file that prints gets its own `print`, unless it declares or imports one. */
export function withPrint(program: Program): Program {
  const written = (text: string, isTyped: boolean) =>
    /\bprint\(/.test(text) && !/\b(function|const|let|var) print\b|^import\b[^;]*\bprint\b/m.test(text)
      ? printFor(isTyped) + text
      : text;
  const files =
    program.files &&
    Object.fromEntries(
      Object.entries(program.files).map(([path, text]) => [
        path,
        /\.[cm]?[jt]sx?$/.test(path) && !path.endsWith(".d.ts") ? written(text, /ts.?$/.test(path)) : text,
      ]),
    );
  return { ...program, text: written(program.text, program.extension === "ts"), ...(files ? { files } : {}) };
}
export const isBuildFlag = (flag: string) =>
  !flag.startsWith(runEnvFlag) &&
  !flag.startsWith(decoyShapesFlag) &&
  !flag.startsWith(projectFlag) &&
  flag !== separateEntryPointsFlag &&
  flag !== withoutCompilerFlag;

const ownOptions = {
  target: "esnext",
  module: "preserve",
  moduleResolution: "bundler",
  allowJs: true,
  noEmit: true,
  strict: true,
};
/**
 * Project files that may lie beside a program. A small script has no tsconfig.json and no typings installed, so the
 * build has to know the host by itself.
 */
export const projects: Record<string, { tsconfig?: { compilerOptions?: object }; hasTypings?: true }> = {
  "default": { tsconfig: { compilerOptions: { ...ownOptions, types: [] } } },
  "no-tsconfig": {},
  "empty-tsconfig": { tsconfig: {} },
  "lib-without-dom": { tsconfig: { compilerOptions: { ...ownOptions, lib: ["esnext"], types: [] } } },
  "bun-init": { tsconfig: { compilerOptions: bunInitCompilerOptions }, hasTypings: true },
};

export class ProductRunner implements Runner {
  readonly name = "product";
  readonly binary: string;
  readonly batch = 64;
  readonly supportsMultiFile = true;
  lastCall?: number;
  withoutFlowResults = ["--aot-disable=flow-results"];
  withoutCompiler = [withoutCompilerFlag];
  #switches?: { flowResults: string[]; passes: string[] };
  #limits?: { name: string; flags: string[] }[];

  constructor(
    readonly bun: string,
    readonly options: {
      baseFlags: string[];
      validate: boolean;
      /** Skip the second run with the run-time checks on. */
      runsOnce?: boolean;
      threads: number;
      buildSeconds: number;
      runSeconds: number;
      /** In bytes, for each build and each run, instead of `memoryLimit`. */
      memory?: number;
      /**
       * The executable's time limit, if it differs from the plain run's: a collection every few allocations is slow.
       */
      compiledRunSeconds?: number;
      /** The executable's time limit when built with --aot-validate, whose checks are slow. */
      validatedRunSeconds?: number;
      /** Only for the executable's run. */
      runEnvironment?: Record<string, string>;
      /** Only these modes. */
      modes?: string[];
      /**
       * The executable runs with a collection at every n-th slow-path allocation, n picked from these, full or eden;
       * freed cells are scribbled and never reused.
       */
      collectorStress?: number[];
      /** Half of the batches use the fenced write barrier. */
      isFenced?: boolean;
      /**
       * One time in n, n picked from these, compiled code takes the slow path after a type check that would have
       * passed.
       */
      failPredictions?: number[];
      lowersLimits?: boolean;
      /** Each batch is built beside this many decoy shapes, picked from these. */
      decoyShapes?: number[];
      /** This many workers run the program concurrently instead of the main thread. */
      workers?: number;
      /**
       * Each batch is built with one of these project setups, keys of `projects`. By default: the runner's own
       * tsconfig.json beside a typed program.
       */
      projects?: string[];
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

  // Workers and decoy shapes need an entry point written by the runner.
  get supportsOwnBuild() {
    return !this.options.workers && !this.options.decoyShapes?.some(size => size > 0);
  }

  // Repeated --aot-disable flags do not add up, nor do repeated --aot-testing flags, so each list is merged into one
  // flag.
  #merged(flags: string[]): string[] {
    let merged = flags;
    for (const list of ["--aot-disable=", "--aot-testing="]) {
      const listed = merged.filter(flag => flag.startsWith(list)).flatMap(flag => flag.slice(list.length).split(","));
      if (listed.length)
        merged = [...merged.filter(flag => !flag.startsWith(list)), list + [...new Set(listed)].join(",")];
    }
    return merged;
  }

  // Different intervals catch different bugs, so each batch gets its own. The choice is part of the mode's flags, so
  // confirmation and reduction use the same one and the finding records it.
  #drawnStress(): string[] {
    const below = (limit: number) => Math.floor(Math.random() * limit);
    const set: string[] = [];
    const intervals = this.options.collectorStress ?? [];
    const drawn = below(intervals.length * 2);
    let interval = intervals[drawn >> 1];
    // Full collections at every first to third slow-path allocation take a hundred times as long as at every fifth, so
    // four in five of those picks get a wider interval. Eden collections keep theirs.
    if (interval && interval < 5 && !(drawn & 1) && below(5)) interval = [5, 7, 11][below(3)];
    // 0 means no extra collections.
    if (interval)
      set.push(
        `BUN_JSC_slowPathAllocsBetweenGCs=${interval}`,
        "BUN_JSC_scribbleFreeCells=1",
        "BUN_JSC_useZombieMode=1",
        ...(drawn & 1 ? ["BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1"] : []),
      );
    if (this.options.isFenced && below(2)) set.push("BUN_JSC_forceFencedBarrier=1");
    const failing = this.options.failPredictions ?? [];
    return [
      ...set.map(each => runEnvFlag + each),
      ...(failing.length ? [`--aot-testing=FailPredictions:${failing[below(failing.length)]}:${below(65536)}`] : []),
    ];
  }

  // Only a large program reaches most limits. With one limit at 0, 1 or 2 a small program runs the code past it. One
  // limit per build.
  #drawnLimit(): string[] {
    if (!this.options.lowersLimits) return [];
    this.#limits ??= limitsLowered(this.bun);
    return this.#limits[Math.floor(Math.random() * this.#limits.length)].flags;
  }

  modes(program: Program): Mode[] {
    const stress = this.#drawnStress();
    const limit = this.#drawnLimit();
    const sizes = this.options.decoyShapes ?? [];
    const size = sizes[Math.floor(Math.random() * sizes.length)];
    const beside = (this.options.projects ?? []).filter(name => !projects[name].hasTypings || bunTypesFolder());
    const project = beside.length ? [projectFlag + beside[Math.floor(Math.random() * beside.length)]] : [];
    const own = program.flags ?? [];
    return this.#modes(program).map(mode => ({
      ...mode,
      name: [mode.name, ...own].join(" "),
      flags: [
        verifierFlags,
        ...mode.flags,
        ...own,
        ...stress,
        ...project,
        ...(size ? [decoyShapesFlag + size] : []),
        ...(mode.flags.some(flag => flag.startsWith("--aot-limit=")) ? [] : limit),
      ],
    }));
  }

  #modes(program: Program): Mode[] {
    const modes: Mode[] = [{ name: "default", flags: [] }];
    if (this.options.validate) modes.push({ name: "validate", flags: ["--aot-validate"] });
    // The shipping code with its proofs checked again at run time: a false proof becomes a named failure where the
    // default build silently gives a wrong answer.
    modes.push({ name: "check-proofs", flags: ["--aot-testing=CheckProofsAtRunTime"] });
    if (program.extension === "ts") modes.push({ name: "erased", flags: ["--aot-erase-types"] });
    // How hot a function is depends on the whole program, and a small program is mostly lukewarm: little is inlined, so
    // the passes after inlining have little to do. One bug only showed when three other modules were built beside the
    // program. All they did was change its heat.
    modes.push({ name: "hot", flags: ["--aot-heat=everything-is-hot"] });
    // A shared build is one program with many modules. What the compiler can only prove about a small program (that no
    // key is ever deleted, say) it never proves there, so bugs in such proofs do not show.
    modes.push({ name: "separate-entry-points", flags: [separateEntryPointsFlag], isForSharedBuilds: true });
    if (!this.options.modes) return modes;
    // Only when named.
    if (program.extension === "ts")
      modes.push({ name: "erased-hot", flags: ["--aot-erase-types", "--aot-heat=everything-is-hot"] });
    modes.push({
      name: "hot-check-proofs",
      flags: ["--aot-heat=everything-is-hot", "--aot-testing=CheckProofsAtRunTime"],
    });
    modes.push({ name: "no-inlining", flags: ["--aot-disable=InlineCalls"] });
    modes.push({ name: "hot-no-inlining", flags: ["--aot-heat=everything-is-hot", "--aot-disable=InlineCalls"] });
    modes.push({ name: "no-flow-results", flags: ["--aot-disable=flow-results"] });
    modes.push({ name: "hot-no-flow-results", flags: ["--aot-heat=everything-is-hot", "--aot-disable=flow-results"] });
    // large and cold-large are what a user's build of a very large program gets.
    modes.push({ name: "cold", flags: ["--aot-heat=everything-is-cold"] });
    modes.push({ name: "large", flags: ["--aot-limit=MaxWarmCodeValues:1"] });
    modes.push({ name: "cold-large", flags: ["--aot-heat=everything-is-cold", "--aot-limit=MaxWarmCodeValues:1"] });
    if (program.extension === "ts")
      modes.push({
        name: "erased-cold-large",
        flags: ["--aot-erase-types", "--aot-heat=everything-is-cold", "--aot-limit=MaxWarmCodeValues:1"],
      });
    if (program.extension === "ts")
      modes.push({ name: "erased-cold", flags: ["--aot-erase-types", "--aot-heat=everything-is-cold"] });
    modes.push({ name: "slow-path-allocations", flags: ["--aot-testing=ForceGCSlowPaths"] });
    // The shipping machine code with the compiler's claims to its back end checked at run time, after the last phase
    // that moves a value: a false claim becomes a named failure even if it does not change the output.
    modes.push({ name: "check-claims", flags: ["--aot-check=ClaimsToBackEnd"] });
    modes.push({ name: "check-moved-loads", flags: ["--aot-check=MovedLoads"] });
    modes.push({ name: "hot-check-claims", flags: ["--aot-heat=everything-is-hot", "--aot-check=ClaimsToBackEnd"] });
    modes.push({ name: "hot-check-moved-loads", flags: ["--aot-heat=everything-is-hot", "--aot-check=MovedLoads"] });
    modes.push({ name: "check-decided-comparisons", flags: ["--aot-check=DecidedComparisons"] });
    modes.push({
      name: "hot-check-decided-comparisons",
      flags: ["--aot-heat=everything-is-hot", "--aot-check=DecidedComparisons"],
    });
    return modes.filter(mode => this.options.modes!.includes(mode.name));
  }

  disabling(names: string[]) {
    return names.length ? ["--aot-disable=" + names.join(",")] : [];
  }

  async switches() {
    if (this.#switches) return this.#switches;
    const folder = withoutInstallingPackages(join(process.env.TMPDIR ?? "/tmp", `aot-fuzz-registry-${process.pid}`));
    writeFileSync(join(folder, "empty.js"), "");
    const listed = await spawned(
      [this.bun, "build", "--compile", "--aot", "empty.js", "--outfile", "empty", "--aot-list=registry"],
      folder,
      120,
    );
    rmSync(folder, { recursive: true, force: true });
    const registry = JSON.parse((listed.stdout + listed.stderr).split("\n").find(line => line.startsWith("{"))!);
    const names = (list: any[]) => list.map(entry => (typeof entry === "string" ? entry : entry.name) as string);
    return (this.#switches = {
      // A bare name may be ambiguous, and the build then rejects it.
      passes: names(registry.passes.filter((pass: any) => pass.isOptional)).map(name => "pass:" + name),
      flowResults: names(registry.flowResults).map(name => "flow:" + name),
    });
  }

  #write(folder: string, stem: string, program: Program, flags: string[]) {
    writeProgram(folder, stem, withPrint(program));
    if (
      /tsx?$/.test(program.extension) &&
      !flags.some(flag => flag.startsWith(projectFlag)) &&
      !existsSync(join(folder, "tsconfig.json"))
    )
      writeFileSync(join(folder, "tsconfig.json"), JSON.stringify(projects["default"].tsconfig));
  }

  // The folder belongs to one worker, which builds one thing at a time.
  #writeProjectFiles(folder: string, flags: string[]) {
    const name = flags.find(flag => flag.startsWith(projectFlag))?.slice(projectFlag.length);
    if (name === undefined) return;
    rmSync(join(folder, "tsconfig.json"), { force: true });
    rmSync(join(folder, "node_modules"), { recursive: true, force: true });
    const { tsconfig, hasTypings } = projects[name];
    if (tsconfig) writeFileSync(join(folder, "tsconfig.json"), JSON.stringify(tsconfig));
    if (!hasTypings) return;
    mkdirSync(join(folder, "node_modules", "@types"), { recursive: true });
    symlinkSync(bunTypesFolder()!, join(folder, "node_modules", "@types", "bun"));
  }

  // A mutant of a typed program may not type-check, and that rightly stops the build. But the build must accept what
  // TypeScript accepts with Bun's typings and plain Bun runs.
  #checkers = new Map<string, Checker | undefined>();
  #judged(program: Program, flags: string[], verdict: Verdict): Verdict {
    if (program.mayBeRefused && verdict.kind === "build error") return { kind: "skipped", why: "the build is refused" };
    if (verdict.kind !== "skipped" || !verdict.refusal || program.mayBeRefused) return verdict;
    // The build reports TypeScript 7's errors, which infers less from a JavaScript file than the TypeScript used here:
    // `arguments`, constructor functions, a subclass of Promise.
    if (Object.keys(program.files ?? {}).some(path => /\.[cm]?js$/.test(path)))
      return { kind: "skipped", why: `${verdict.why}, beside JavaScript` };
    const name = flags.find(flag => flag.startsWith(projectFlag))?.slice(projectFlag.length) ?? "default";
    const { tsconfig } = projects[name];
    if (!this.#checkers.has(name))
      this.#checkers.set(
        name,
        typeChecker({ typings: bunTypesFolder(), options: tsconfig && (tsconfig.compilerOptions ?? {}) }),
      );
    const errors = this.#checkers.get(name)?.([withPrint(program)])[0];
    if (!errors) return verdict;
    if (errors.length) return { kind: "skipped", why: `${verdict.why}, as in TypeScript` };
    // Names stay in the signature of a rejected build: a member missing on one class says nothing about another class.
    return {
      kind: "build refused",
      detail: `${verdict.refusal.slice(0, 200)} | TypeScript accepts the program`,
      signature: verdict.refusal.replace(/\d+/g, "N").slice(0, 200),
    };
  }

  /**
   * Runs it like a user. If that run exits normally, the same executable runs once more with the run-time checks on:
   * they report anything the compiler assumed impossible, even if the first run's output was right. Only such a report
   * counts from the second run.
   */
  async #run(folder: string, cmd: string[], flags: string[]) {
    const run = await this.#runOnce(folder, cmd, flags);
    if (
      this.options.runsOnce ||
      run.signal ||
      run.timedOut ||
      flags.includes("--aot-validate") ||
      validationMessage.test(run.stderr)
    )
      return run;
    const checked = await this.#runOnce(folder, cmd, [...flags, runEnvFlag + runtimeChecksVariable]);
    if (!validationMessage.test(checked.stderr)) return run;
    return {
      ...checked,
      stderr: checked.stderr.replace(validationMessage, line => `${line} | ${runtimeChecksVariable}`),
    };
  }

  #runOnce(folder: string, cmd: string[], flags: string[]) {
    const drawn = flags
      .filter(flag => flag.startsWith(runEnvFlag))
      .map(flag => flag.slice(runEnvFlag.length).split("="));
    const seconds =
      (flags.includes("--aot-validate") ? this.options.validatedRunSeconds : undefined) ??
      this.options.compiledRunSeconds ??
      this.options.runSeconds;
    const set: Record<string, string> = { ...this.options.runEnvironment, ...Object.fromEntries(drawn) };
    // With forced collections, the sweep scribbles dead cells.
    if (set.BUN_JSC_slowPathAllocsBetweenGCs || set.BUN_JSC_collectContinuously === "1")
      set.BUN_JSC_useZombieMode ??= "1";
    return spawned(cmd, folder, seconds, set, this.options.memory, true);
  }

  #build(folder: string, entry: string, flags: string[], further: string[] = [], from = folder) {
    const all = this.#merged([...this.options.baseFlags, ...flags]).filter(isBuildFlag);
    return spawned(
      [
        this.bun,
        "build",
        "--compile",
        ...(flags.includes(withoutCompilerFlag)
          ? all.filter(flag => !flag.startsWith("--aot"))
          : ["--aot", `--aot-threads=${this.options.threads}`, ...all]),
        entry,
        ...further,
        "--outfile",
        join(folder, "executable"),
      ],
      from,
      this.options.buildSeconds,
      undefined,
      this.options.memory,
    );
  }

  // Workers and decoy shapes only work for modules of one program.
  #extraEntryPoints(programs: Program[], members: number[], flags: string[]): string[] {
    return flags.includes(separateEntryPointsFlag) &&
      !this.options.workers &&
      !flags.some(flag => flag.startsWith(decoyShapesFlag))
      ? members.map(index => "./" + entryOf(`p${index}`, programs[index]))
      : [];
  }

  async judge(folder: string, programs: Program[], flags: string[]): Promise<Judged[]> {
    const executable = join(folder, process.platform === "win32" ? "executable.exe" : "executable");
    try {
      if (programs.length !== 1 || this.options.workers || flags.some(flag => flag.startsWith(decoyShapesFlag)))
        return await this.#judgeBatch(folder, programs, flags);
      const [program] = programs;
      const home = program.runsInOwnFolder && program.files ? join(folder, "program") : folder;
      const file = home === folder ? entryOf("program", program) : `main.${program.extension}`;
      this.#writeProjectFiles(folder, flags);
      this.#write(folder, "program", program, flags);
      // Not `bun run`: it adds its own variables (npm_..) to the program's environment.
      const plain = await spawned(
        [this.bun, `./${file}`],
        home,
        this.options.runSeconds,
        program.plainEnvironment,
        this.options.memory,
        true,
      );
      const early = unusable(this, plain);
      if (early) return [{ plain, verdict: early }];
      rmSync(executable, { force: true });
      const build = await this.#build(
        folder,
        file,
        flags,
        program.entryPoints?.map(path => (home === folder ? `program/${path}` : path)),
        home,
      );
      const compiled: Compiled =
        existsSync(executable) && build.exitCode === 0
          ? { build, run: await this.#run(home, [executable], flags) }
          : { build };
      let verdict = compare(this, program, plain, compiled);
      for (
        let again = 0;
        again < 40 &&
        program.unstablePlainOutput &&
        compiled.run &&
        (verdict.kind === "different output" || verdict.kind === "different exit code");
        again++
      ) {
        const other = await spawned(
          [this.bun, `./${file}`],
          home,
          this.options.runSeconds,
          undefined,
          this.options.memory,
          true,
        );
        if (other.stdout === compiled.run.stdout && other.exitCode === compiled.run.exitCode)
          verdict = { kind: "skipped", why: program.unstablePlainOutput };
      }
      return [{ plain, compiled, verdict: this.#judged(program, flags, verdict) }];
    } finally {
      rmSync(executable, { force: true });
      rmSync(join(folder, "program"), { recursive: true, force: true });
    }
  }

  // To the checker a file without `import` or `export` is a script, and two scripts share their top-level names. A
  // JavaScript program from ../programs stays a script: as a module it would be strict, with a different `this`. Its
  // first line says so.
  #asModule(program: Program): Program {
    return /^(import|export)\b/m.test(program.text) || program.text.startsWith(scriptMarker)
      ? program
      : { ...program, text: program.text + "\nexport {};\n" };
  }

  #writeModules(folder: string, programs: Program[], flags: string[]) {
    this.#writeProjectFiles(folder, flags);
    programs.forEach((program, index) => this.#write(folder, `p${index}`, this.#asModule(program), flags));
  }

  #writeEntryPoint(folder: string, programs: Program[], members: number[], flags: string[]) {
    const size = Number(flags.find(flag => flag.startsWith(decoyShapesFlag))?.slice(decoyShapesFlag.length) ?? 0);
    if (size) writeFileSync(join(folder, "decoy-shapes.js"), decoyShapes(size, memberNames(programs.map(wholeText))));
    const further = this.#extraEntryPoints(programs, members, flags);
    if (further.length)
      return writeFileSync(
        join(folder, "main.js"),
        `const programs = {\n${members.map((index, at) => `  ${index}: "${further[at]}",\n`).join("")}};
const worker = new Worker(new URL(programs[process.argv[2]], import.meta.url));
worker.addEventListener("error", event => console.error("error: " + event.message));
process.exitCode = await new Promise(resolve => worker.addEventListener("close", event => resolve(event.code)));
`,
      );
    const table = `${size ? `import "./decoy-shapes.js";\n` : ""}const programs = {\n${members.map(index => `  ${index}: () => import("./${entryOf(`p${index}`, programs[index])}"),\n`).join("")}};\n`;
    if (!this.options.workers)
      return writeFileSync(join(folder, "main.js"), `${table}await programs[process.argv[2]]();\n`);
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

  // Threads print in any order. Every line must appear as often as in plain Bun.
  #inAnyOrder(run: Run): Run {
    return this.options.workers ? { ...run, stdout: run.stdout.split("\n").sort().join("\n") } : run;
  }

  store(folder: string, programs: Program[], flags: string[]) {
    this.#writeModules(folder, programs, flags);
    this.#writeEntryPoint(folder, programs, programs.map((_, index) => index), flags); // prettier-ignore
    const merged = this.#merged([...this.options.baseFlags, ...flags]);
    const [inRun, inBuild] = [merged.filter(flag => flag.startsWith(runEnvFlag)), merged.filter(isBuildFlag)];
    const further = this.#extraEntryPoints(programs, programs.map((_, index) => index), flags); // prettier-ignore
    return `bun run main.js 0\nbun ${["build", "--compile", "--aot", ...inBuild, "main.js", ...further, "--outfile", "executable"].join(" ")} && ${inRun.map(flag => flag.slice(runEnvFlag.length) + " ").join("")}./executable 0\n`;
  }

  // One build holds every program as its own module, and an argument selects the one a run imports: Bun's own library
  // is compiled once for all of them, and runs do not affect each other. The compiler analyzes all of them as one
  // program, except in the mode separate-entry-points, where each is an entry point and runs in a Worker.
  async #judgeBatch(folder: string, programs: Program[], flags: string[]): Promise<Judged[]> {
    const executable = join(folder, process.platform === "win32" ? "executable.exe" : "executable");
    const results = new Array<Judged>(programs.length);
    const entry = (members: number[]) => this.#writeEntryPoint(folder, programs, members, flags);
    const all = programs.map((_, index) => index);
    this.#writeModules(folder, programs, flags);
    entry(all);
    const plains = (
      await inParallel(all, 4, index =>
        spawned(
          [this.bun, "./main.js", String(index)],
          folder,
          this.options.runSeconds,
          undefined,
          this.options.memory,
          true,
        ),
      )
    ).map(run => this.#inAnyOrder(run));
    for (const index of all) {
      const early = unusable(this, plains[index]);
      if (early) results[index] = { plain: plains[index], verdict: early };
    }

    const together = async (members: number[]): Promise<void> => {
      if (!members.length) return;
      entry(members);
      rmSync(executable, { force: true });
      const build = await this.#build(folder, "main.js", flags, this.#extraEntryPoints(programs, members, flags));
      if (existsSync(executable) && build.exitCode === 0) {
        const runs = (await inParallel(members, 4, index => this.#run(folder, [executable, String(index)], flags))).map(
          run => this.#inAnyOrder(run),
        );
        members.forEach((index, at) => {
          const compiled = { build, run: runs[at] };
          results[index] = {
            plain: plains[index],
            compiled,
            verdict: compare(this, programs[index], plains[index], compiled),
          };
        });
        return;
      }
      // Which program is the culprit? An error names a file; if it names none, bisect.
      const blamed = new Map<number, string>();
      for (const record of (build.stderr + "\n" + build.stdout).split(/\n(?=error\b)/)) {
        if (!record.startsWith("error")) continue;
        const named = /\bp(\d+)(?:\.(?:js|ts)\b|\/[\w.-])/.exec(record.split(/\n\s*\n/)[0]);
        if (named && members.includes(Number(named[1])) && !blamed.has(Number(named[1])))
          blamed.set(Number(named[1]), record.split(/\n\s*\n/)[0]);
      }
      if (members.length === 1 || blamed.size || Date.now() > (this.lastCall ?? Infinity)) {
        for (const index of blamed.size ? blamed.keys() : members) {
          const compiled = { build: blamed.size ? { ...build, stdout: "", stderr: blamed.get(index)! } : build };
          results[index] = {
            plain: plains[index],
            compiled,
            verdict: this.#judged(
              this.#asModule(programs[index]),
              flags,
              compare(this, programs[index], plains[index], compiled),
            ),
          };
        }
        return together(members.filter(index => !results[index]));
      }
      await together(members.slice(0, members.length >> 1));
      await together(members.slice(members.length >> 1));
    };
    await together(all.filter(index => !results[index]));
    for (const index of all)
      rmSync(join(folder, programs[index].files ? `p${index}` : entryOf(`p${index}`, programs[index])), {
        recursive: true,
        force: true,
      });
    rmSync(join(folder, "decoy-shapes.js"), { force: true });
    return results;
  }
}

// A `console` for the shell, which has none: the programs in test/aot/programs print through it. Uses only loops and
// native functions.
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

export class EngineRunner implements Runner {
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
    this.binary =
      "testaot-" +
      (existsSync(join(tools, "stamp")) ? readFileSync(join(tools, "stamp"), "utf8").trim() : tools.split("/").pop());
  }

  // The shell has no host, and calling a host built-in there is undefined behavior.
  accepts(program: Program) {
    return program.extension === "js" && !program.files && !/\b(import|require|Bun|process|setTimeout|setInterval|setImmediate|queueMicrotask|structuredClone|Buffer|fetch|Response|Request|Headers|URL|URLSearchParams|TextEncoder|TextDecoder|performance|navigator|crypto|AbortController|Blob|Worker|WebSocket|EventTarget|Event|alert|prompt|confirm|BroadcastChannel|MessageChannel|atob|btoa|reportError|self|Intl|WebAssembly|gc|noInline)\b/.test(program.text); // prettier-ignore
  }

  // For a built-in written in JavaScript a stand-in returns undefined: prepare() finds out which ones.
  allows(text: string) {
    return this.accepts({ text, extension: "js" }) && !this.#missing.test(text);
  }

  /** Probes what the runner can do. Call it once before allows(). Returns the patterns of what it cannot do. */
  async prepare(folder: string): Promise<string[]> {
    mkdirSync(folder, { recursive: true });
    const all = [...probes, ...laterProbes];
    const missing = new Set<string>();
    // Ten at a time; if not all ten answer as in plain JavaScript, one at a time, because a crash hides the rest.
    const ask = async (groups: number[][]) => {
      const judged = await this.judge(
        folder,
        groups.map(numbers => ({ text: probeProgram(numbers), extension: "js" })),
        [],
      );
      return groups.filter((_, index) => judged[index].verdict.kind !== "same");
    };
    const tens = Array.from({ length: Math.ceil(all.length / 10) }, (_, index) =>
      all.map((_, number) => number).slice(index * 10, index * 10 + 10),
    );
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
    return (this.#switches = {
      flowResults: names.filter(name => name.startsWith("flow:")),
      passes: names.filter(name => name.startsWith("pass:")),
    });
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
      const lowered = await spawned(
        [
          join(this.tools, "fe"),
          "compile",
          "program.js",
          `--aot-out=${text}`,
          "--text",
          "--aot-threads=2",
          "--no-builtin-modules",
        ],
        folder,
        this.options.buildSeconds,
      );
      if (lowered.exitCode !== 0 || !existsSync(text))
        return { build: { ...lowered, stderr: "front end: " + lowered.stderr + lowered.stdout } };
      writeFileSync(text, adapted(readFileSync(text, "utf8")));
      this.#lowered.set(folder, program.text);
    }
    try {
      const disabled = [...this.options.baseFlags, ...flags]
        .filter(flag => flag.startsWith("disable="))
        .flatMap(flag => flag.slice("disable=".length).split(","));
      const rest = [...this.options.baseFlags, ...flags].filter(flag => !flag.startsWith("disable="));
      const build = await spawned(
        [
          join(this.tools, "testaot"),
          "compile",
          text,
          `--output=${image}`,
          ...rest,
          ...(disabled.length ? ["disable=" + disabled.join(",")] : []),
        ],
        folder,
        this.options.buildSeconds,
      );
      const entry = /^entry \S+ (\S+)/m.exec(build.stdout)?.[1];
      if (build.exitCode !== 0 || !entry)
        return { build: { ...build, stderr: build.stderr + build.stdout.replace(/^(entry|loss).*\n/gm, "") } };
      return {
        build,
        run: await spawned(
          [
            join(this.tools, "jsc"),
            `--aotImagePath=${image}`,
            "-e",
            `runCompiledEntryPoint(${entry}); drainMicrotasks()`,
          ],
          folder,
          this.options.runSeconds,
        ),
      };
    } finally {
      rmSync(image, { force: true });
    }
  }
}

// The front end may be older or newer than testaot. The ids of the host's library functions change whenever the table
// of built-ins changes: without these lines every library function is the stand-in. A front end from before
// `DefineMethod .. index=N` omits the index: one counter per class object, 0 not written.
function adapted(text: string): string {
  const lines = text.split("\n").filter(line => !line.startsWith("runtimefunction "));
  if (lines.some(line => line.trimStart().startsWith("DefineMethod ") && line.includes(" index=")))
    return lines.join("\n");
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

/** Removes numbers, names and paths from a message, so that two reports of one cause read the same. */
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
const uncaught = (run: Run) =>
  (run.stderr + "\n" + run.stdout).split("\n").find(line => /^(error|Exception|[A-Za-z]*Error)\b/.test(line)) ?? "";

const validationMessage = /^.*(AOT validation|validation failed).*$/m;

// Checks the compiler can run on itself during a build without changing a byte of the executable. A user's build does
// not pay for them.
export const verifierFlags = "--aot-check=verify-each-stage,validate-references,flow-fixpoint,used-values-are-listed";

export function compare(runner: Runner, program: Program, plain: Run, compiled: Compiled): Verdict {
  const failure = (kind: FindingKind, detail: string, signature = detail): Failure => ({ kind, detail, signature });
  const { build, run } = compiled;
  const said = build.stderr + "\n" + build.stdout;
  if (!run) {
    if (build.timedOut) return failure("build hang", build.ranOutOfMemory ? "took too much memory" : "");
    // The first line may only say that the program is invalid; the following lines say what is wrong.
    const internal = said.match(/^.*internal compiler error.*$/gm);
    if (internal)
      return failure(
        "internal compiler error",
        normalized(
          (internal.find(line => !line.includes("VerificationFailedAtTheEnd")) ?? internal[0]).replace(
            /;? (in )?function .*$/,
            "",
          ),
        ),
      );
    if (build.signal || /\bpanic(ked)?\b|ASSERTION FAILED|SHOULD NEVER BE REACHED|Segmentation fault/.test(said))
      return failure(
        "build crash",
        `${build.signal ?? ""} ${normalized(/^.*(panic|ASSERTION FAILED|SHOULD NEVER BE REACHED|Segmentation fault|AOT: ).*$/m.exec(said)?.[0] ?? "")}`.trim(),
      );
    // A mutant of a typed program may not type-check, and that stops the build.
    const refusal = /tsx?$/.test(program.extension) && /\berror: (TS\d+).*/.exec(said);
    if (refusal)
      return { kind: "skipped", why: `type error ${refusal[1]}`, refusal: refusal[0].slice("error: ".length) };
    const error = /^(front end: )?.*\berror\b.*$/im.exec(said)?.[0] ?? said.trim().split("\n")[0] ?? "";
    // testaot reports what the product calls an internal compiler error as `<Name>: <meaning>; function ..`.
    if (runner.name === "engine" && /^[A-Z][A-Za-z]+: /.test(said.trim()))
      return failure(
        "internal compiler error",
        normalized(
          said
            .trim()
            .split("\n")[0]
            .replace(/; function .*$/, ""),
        ),
      );
    return failure("build error", normalized(error));
  }
  const invalid = validationMessage.exec(run.stderr + "\n" + run.stdout);
  // The line before a report about a native call names the entry and the rule it broke: two entries, or two rules, are
  // two findings.
  const nativeCall = /^AOT(?: native call)?: .*$/m.exec(run.stderr)?.[0] ?? "";
  if (invalid && !validationMessage.test(plain.stderr + "\n" + plain.stdout))
    return failure(
      "validation failure",
      `${invalid[0]} ${nativeCall}`.trim().slice(0, 200),
      normalized(`${invalid[0]} ${nativeCall}`),
    );
  if (run.signal)
    return failure(
      "crash",
      `${run.signal} ${normalized(/^.*(panic|ASSERTION FAILED|SHOULD NEVER BE REACHED|Segmentation fault|AOT: |FATAL: out of memory).*$/m.exec(run.stderr)?.[0] ?? "")}`.trim(),
    );
  if (run.timedOut) return failure("hang", run.ranOutOfMemory ? "took too much memory" : "");
  if (run.stdout === plain.stdout && run.exitCode === plain.exitCode) return { kind: "same" };
  const why = program.meant?.(plain.stdout, run.stdout);
  if (why) return { kind: "skipped", why };
  const exits =
    run.exitCode === plain.exitCode
      ? ""
      : ` | exit codes ${plain.exitCode} ${run.exitCode}: ${uncaught(run.exitCode ? run : plain).slice(0, 160)}`;
  const codes = `${plain.exitCode} ${run.exitCode} ${normalized(uncaught(run.exitCode ? run : plain))}`;
  if (run.stdout === plain.stdout) return failure("different exit code", exits.slice(3), codes);
  const [ours, theirs] = [run.stdout.split("\n"), plain.stdout.split("\n")];
  const line = ours.findIndex((text, index) => text !== theirs[index]);
  const at = line < 0 ? ours.length : line;
  // A reduced program must differ at the same place, or the reduction drifts to whatever difference is cheapest to
  // keep. In most programs the first word of a line is its label.
  const label = (text: string | undefined) => /^\S*/.exec(text ?? "<end>")![0].slice(0, 40);
  const signature = run.exitCode === plain.exitCode ? `values ${label(theirs[at])} ${label(ours[at])}` : codes;
  const overflowed = [theirs[at], ours[at]].some(text => text?.includes("Maximum call stack size exceeded"))
    ? " | the line tells of a stack overflow"
    : "";
  const [theirLine, ourLine] = [theirs[at] ?? "<end>", ours[at] ?? "<end>"];
  let firstDifference = 0;
  while (firstDifference < theirLine.length && theirLine[firstDifference] === ourLine[firstDifference])
    firstDifference++;
  const from = firstDifference < 100 ? 0 : firstDifference - 40;
  const shown = (text: string) => JSON.stringify((from ? ".." : "") + text.slice(from, from + 120));
  const place = from ? `at character ${firstDifference} of the line ` : "";
  return failure(
    "different output",
    `${place}plain ${shown(theirLine)} compiled ${shown(ourLine)}${exits}${overflowed}`,
    signature,
  );
}
