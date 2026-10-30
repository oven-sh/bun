// Measures one idiom of ./idioms or ./everyday three ways: compiled ahead of time as TypeScript and as JavaScript, and the same JavaScript under the same binary's JIT.
// ./idioms-against-the-jit.ts says how, and prints the table; ./idioms-against-the-jit.test.ts holds each idiom against a bound.
import { existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { measureCommand, measureCommandWithMemory } from "../analysis-scaling/measure-check";
import { writeEverydayIdioms } from "./everyday-idioms";
import { writeTypedIdioms, writeUntypedIdioms } from "./untyped-idioms";

type Turns = { turns: number; warmUp: number };
export type Cost = {
  instructions: number;
  collections: number;
  peakMegabytes: number;
  peakMegabytesOfAQuarter: number;
  printed: string;
};
export type Row = { name: string; failure?: string; typed?: Cost; untyped?: Cost; jit?: Cost };
export type WholeRow = Required<Omit<Row, "failure">> & { failure?: string };

export const isWhole = (row: Row): row is WholeRow => !!row.jit;
/** The worse of the two compiled forms over the JIT. */
export const ratioOf = (row: WholeRow) =>
  Math.max(row.typed.instructions, row.untyped.instructions) / row.jit.instructions;
/** Compiled code is to take fewer instructions than the JIT's last tier. What takes more is listed, with the ratio. */
export const lineAgainstTheJit = 1;
export const behindPath = join(import.meta.dir, `behind-the-jit.${process.platform}-${process.arch}.json`);
export const typedOverUntyped = (row: WholeRow) => row.typed.instructions / row.untyped.instructions;
export const isTypedDearer = (row: WholeRow, bound = 1.05, slack = 1) =>
  typedOverUntyped(row) > bound && row.typed.instructions > row.untyped.instructions + slack;
export const dearerPath = join(import.meta.dir, `typed-dearer-than-untyped.${process.platform}-${process.arch}.json`);
export const everydayPinsPath = join(import.meta.dir, `everyday-pins.${process.platform}-${process.arch}.json`);
export const behindInVeryLargeProgramPath = join(
  import.meta.dir,
  `behind-the-jit-in-a-very-large-program.${process.platform}-${process.arch}.json`,
);
// A program of over four times this limit is very large: there only what stands in a loop of the text, or has four callers, counts as code that runs often.
export const flagsOfVeryLargeProgram = ["--aot-limit=MaxWarmCodeValues:1"];

/**
 * Writes every idiom's sources into `folder`: the TypeScript into one folder with a tsconfig.json, the JavaScript into another without. `collections: false` leaves out the run that counts them; `buildFlags` go to every `bun build --compile --aot`.
 * `inVeryLargeProgram` compiles each idiom as the same text would be compiled inside a very large program, and the idioms of ./everyday find turn() at run time.
 * `jit: false` leaves out the runs under the JIT. `together` names the idioms that will be measured: they are the entry points of a few executables, each compiled as it is when it is built alone.
 */
export function idiomsAgainstTheJit(
  bun: string,
  folder: string,
  {
    collections = true,
    buildFlags = [] as string[],
    inVeryLargeProgram = false,
    jit: measuresJit = true,
    together = undefined as string[] | undefined,
  } = {},
) {
  if (inVeryLargeProgram) buildFlags = [...flagsOfVeryLargeProgram, ...buildFlags];
  const sources = { typed: join(folder, "idioms"), untyped: join(folder, "untyped-idioms") };
  const environment = {
    PATH: process.env.PATH,
    HOME: folder,
    TMPDIR: folder,
    NO_COLOR: "1",
    BUN_ENABLE_CRASH_REPORTING: "0",
    DO_NOT_TRACK: "1",
    BUN_GC_TIMER_DISABLE: "1",
    BUN_JSC_percentCPUPerMBForEdenTimer: "0",
    BUN_JSC_percentCPUPerMBForFullTimer: "0",
    BUN_JSC_useConcurrentGC: "0",
    BUN_JSC_numberOfGCMarkers: "1",
    BUN_JSC_useConcurrentJIT: "0",
  };

  async function run(cwd: string, cmd: string[]) {
    await using child = Bun.spawn({
      cmd,
      cwd,
      env: environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 900_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    if (exitCode !== 0)
      throw new Error(
        `exit code ${exitCode}${child.signalCode ? ", " + child.signalCode : ""}: ${(stderr + stdout).trim().split("\n").slice(0, 3).join(" / ").slice(0, 300)}`,
      );
  }

  // What wait4() says of a child is never under what its parent had resident when it started the child: GNU time is a small parent.
  const underTime =
    process.platform === "linux" && existsSync("/usr/bin/time") ? ["/usr/bin/time", "-f", "peak %M"] : [];

  async function counted(cmd: string[], { turns, warmUp }: Turns, extra: Record<string, string> = {}) {
    const run = await (underTime.length ? measureCommand : measureCommandWithMemory)(
      folder,
      [...underTime, ...cmd],
      900_000,
      {
        ...environment,
        AOT_PERF_TURNS: String(turns),
        AOT_PERF_WARM_UP_TURNS: String(warmUp),
        ...extra,
      },
    );
    const { instructions, stdout, stderr } = run;
    if (!instructions) throw new Error("instructions cannot be counted here");
    const peakKilobytes = "peakBytes" in run ? run.peakBytes / 1024 : Number(/^peak (\d+)$/m.exec(stderr)?.[1]);
    return {
      instructions,
      peakMegabytes: peakKilobytes / 1024,
      printed: stdout,
      collections: stderr.match(/^.*GC\b.*$/gm)?.length ?? 0,
    };
  }

  async function cost(cmd: string[], plan: Turns, extra: Record<string, string> = {}): Promise<Cost> {
    const short = await counted(cmd, { ...plan, turns: plan.turns >> 2 }, extra);
    const long = await counted(cmd, plan, extra);
    const logged = collections ? await counted(cmd, plan, { ...extra, BUN_JSC_logGC: "1" }) : { collections: 0 };
    return {
      instructions: Math.max(0.5, (long.instructions - short.instructions) / (plan.turns - (plan.turns >> 2))),
      collections: logged.collections,
      peakMegabytes: long.peakMegabytes,
      peakMegabytesOfAQuarter: short.peakMegabytes,
      printed: long.printed,
    };
  }

  // As many turns as make 800 million instructions. A turn that mostly waits, for a timer say, executes little: of those, as many as take twenty seconds.
  // Half a millisecond a turn is two seconds between the two runs: more than a busy machine adds by chance. Too few turns would leave the JIT's compiling inside what is measured.
  async function planFor(executable: string, extra: Record<string, string> = {}): Promise<Turns> {
    const began = performance.now();
    const few = await counted([executable], { turns: 1000, warmUp: 20 }, extra);
    const between = performance.now();
    const more = await counted([executable], { turns: 5000, warmUp: 20 }, extra);
    const aTurn = Math.max(1, (more.instructions - few.instructions) / 4000);
    const secondsATurn = (performance.now() - between - (between - began)) / 1000 / 4000;
    const waits = secondsATurn > 500e-6 && secondsATurn > (20 * aTurn) / 1e9;
    const clamp = (value: number, least: number, most: number) => Math.round(Math.min(most, Math.max(least, value)));
    return {
      turns: clamp(waits ? 20 / secondsATurn : 800e6 / aTurn, 8000, 20e6),
      warmUp: clamp(waits ? 0 : 10e6 / aTurn, 100, 5000),
    };
  }

  // Where the compiler folds a turn's work away, the plan would have the JIT repeat that work twenty million times. A turn that takes the JIT's first tiers over
  // fifty thousand instructions, more than its compiling adds to a thousand turns, is repeated no more often than makes a hundred billion.
  async function withinReachOf(cmd: string[], plan: Turns): Promise<Turns> {
    if (plan.turns <= 2e6) return plan;
    const few = await counted(cmd, { turns: 200, warmUp: 20 });
    const more = await counted(cmd, { turns: 1200, warmUp: 20 });
    const aTurn = (more.instructions - few.instructions) / 1000;
    return aTurn > 50e3 ? { ...plan, turns: Math.max(8000, Math.round(100e9 / aTurn)) } : plan;
  }

  const pinnedTurns: Record<string, number> = JSON.parse(readFileSync(join(import.meta.dir, "turns.json"), "utf8"));

  const extensions = { typed: ".ts", untyped: ".js" };
  const build = (form: "typed" | "untyped", entryPoints: string[], executable: string, flags: string[] = []) =>
    run(sources[form], [
      bun,
      "build",
      "--compile",
      "--aot",
      ...flags,
      ...buildFlags,
      ...entryPoints.map(name => join(sources[form], name + extensions[form])),
      "--outfile",
      executable,
    ]);

  const idiomsInOneExecutable = 128;
  const builtTogether = new Map<string, Promise<string>>();
  /** The executable that holds the idiom among others. BUN_AOT_START_AT says which of them a run starts. */
  function executableOfMany(form: "typed" | "untyped", name: string) {
    const first = Math.floor(together!.indexOf(name) / idiomsInOneExecutable) * idiomsInOneExecutable;
    const executable = join(folder, `${form}-from-${first}`);
    if (!builtTogether.has(executable))
      builtTogether.set(
        executable,
        build(form, together!.slice(first, first + idiomsInOneExecutable), executable, [
          "--aot-separate-programs",
          `--root=${sources[form]}`,
        ]).then(() => executable),
      );
    return builtTogether.get(executable)!;
  }

  async function measure(name: string): Promise<Row> {
    const alone = {
      typed: join(folder, name.replaceAll("/", "-") + "-typed"),
      untyped: join(folder, name.replaceAll("/", "-") + "-untyped"),
    };
    try {
      const executables = together
        ? { typed: await executableOfMany("typed", name), untyped: await executableOfMany("untyped", name) }
        : alone;
      if (!together) for (const form of ["typed", "untyped"] as const) await build(form, [name], alone[form]);
      const startsAt = (form: "typed" | "untyped"): Record<string, string> =>
        together ? { BUN_AOT_START_AT: name + extensions[form] } : {};
      const underTheJit = [bun, "run", "--no-install", join(sources.untyped, name + ".js")];
      const planned =
        name in pinnedTurns
          ? { turns: pinnedTurns[name], warmUp: 5000 }
          : await planFor(executables.untyped, startsAt("untyped"));
      const plan = measuresJit && !(name in pinnedTurns) ? await withinReachOf(underTheJit, planned) : planned;
      const typed = await cost([executables.typed], plan, startsAt("typed"));
      const untyped = await cost([executables.untyped], plan, startsAt("untyped"));
      const jit = measuresJit ? await cost(underTheJit, plan) : undefined;
      const printed = [typed.printed, untyped.printed, ...(jit ? [jit.printed] : [])];
      const failure = printed.every(text => text === printed[0]) ? undefined : `prints ${JSON.stringify(printed)}`;
      return { name, failure, typed, untyped, jit };
    } catch (error) {
      return { name, failure: String((error as Error).message) };
    } finally {
      for (const executable of Object.values(alone)) rmSync(executable, { force: true });
    }
  }

  writeTypedIdioms(sources.typed);
  writeUntypedIdioms(sources.untyped);
  const names = [
    ...readdirSync(join(import.meta.dir, "idioms"), { recursive: true })
      .map(String)
      .filter(path => path.endsWith(".ts") && path !== "host.ts")
      .map(path => path.slice(0, -3).replaceAll("\\", "/")),
    ...writeEverydayIdioms(sources.typed, sources.untyped, inVeryLargeProgram),
  ].sort();
  for (let first = 0; first < (together?.length ?? 0); first += idiomsInOneExecutable)
    for (const form of ["typed", "untyped"] as const) executableOfMany(form, together![first]).catch(() => {});
  return { names, measure };
}
