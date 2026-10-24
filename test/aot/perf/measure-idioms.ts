// Measures one idiom of ./idioms or ./everyday three ways: compiled ahead of time as TypeScript and as JavaScript, and the same JavaScript under the same binary's JIT.
// ./idioms-against-the-jit.ts says how, and prints the table; ./idioms-against-the-jit.test.ts holds each idiom against a bound.
import { existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
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
export const behindPath = join(import.meta.dir, `behind-the-jit.${process.platform}-${process.arch}.json`);
export const typedOverUntyped = (row: WholeRow) => row.typed.instructions / row.untyped.instructions;
export const isTypedDearer = (row: WholeRow, bound = 1.05, slack = 1) =>
  typedOverUntyped(row) > bound && row.typed.instructions > row.untyped.instructions + slack;
export const dearerPath = join(import.meta.dir, `typed-dearer-than-untyped.${process.platform}-${process.arch}.json`);
export const behindInVeryLargeProgramPath = join(
  import.meta.dir,
  `behind-the-jit-in-a-very-large-program.${process.platform}-${process.arch}.json`,
);
// A program of over four times this limit is very large: there only what stands in a loop of the text, or has four callers, counts as code that runs often.
export const flagsOfVeryLargeProgram = ["--aot-limit=MaxWarmCodeValues:1"];

/**
 * Writes every idiom's sources into `folder`: the TypeScript into one folder with a tsconfig.json, the JavaScript into another without. `collections: false` leaves out the run that counts them; `buildFlags` go to every `bun build --compile --aot`.
 * `inVeryLargeProgram` compiles each idiom as the same text would be compiled inside a very large program, and the idioms of ./everyday find turn() at run time.
 */
export function idiomsAgainstTheJit(
  bun: string,
  folder: string,
  { collections = true, buildFlags = [] as string[], inVeryLargeProgram = false } = {},
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
    const { instructions, peakBytes, stdout, stderr } = await measureCommand(folder, [...underTime, ...cmd], 900_000, {
      ...environment,
      AOT_PERF_TURNS: String(turns),
      AOT_PERF_WARM_UP_TURNS: String(warmUp),
      ...extra,
    });
    if (!instructions) throw new Error("instructions cannot be counted here");
    const peakKilobytes = Number(/^peak (\d+)$/m.exec(stderr)?.[1] ?? peakBytes / 1024);
    return {
      instructions,
      peakMegabytes: peakKilobytes / 1024,
      printed: stdout,
      collections: stderr.match(/^.*GC\b.*$/gm)?.length ?? 0,
    };
  }

  async function cost(cmd: string[], plan: Turns): Promise<Cost> {
    const short = await counted(cmd, { ...plan, turns: plan.turns >> 2 });
    const long = await counted(cmd, plan);
    const logged = collections ? await counted(cmd, plan, { BUN_JSC_logGC: "1" }) : { collections: 0 };
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
  async function planFor(executable: string): Promise<Turns> {
    const began = performance.now();
    const few = await counted([executable], { turns: 1000, warmUp: 20 });
    const between = performance.now();
    const more = await counted([executable], { turns: 5000, warmUp: 20 });
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

  async function measure(name: string): Promise<Row> {
    const executables = {
      typed: join(folder, name.replaceAll("/", "-") + "-typed"),
      untyped: join(folder, name.replaceAll("/", "-") + "-untyped"),
    };
    try {
      await run(sources.typed, [
        bun,
        "build",
        "--compile",
        "--aot",
        ...buildFlags,
        join(sources.typed, name + ".ts"),
        "--outfile",
        executables.typed,
      ]);
      await run(sources.untyped, [
        bun,
        "build",
        "--compile",
        "--aot",
        ...buildFlags,
        join(sources.untyped, name + ".js"),
        "--outfile",
        executables.untyped,
      ]);
      const underTheJit = [bun, "run", "--no-install", join(sources.untyped, name + ".js")];
      const plan =
        name in pinnedTurns
          ? { turns: pinnedTurns[name], warmUp: 5000 }
          : await withinReachOf(underTheJit, await planFor(executables.untyped));
      const typed = await cost([executables.typed], plan);
      const untyped = await cost([executables.untyped], plan);
      const jit = await cost(underTheJit, plan);
      const failure =
        typed.printed === jit.printed && untyped.printed === jit.printed
          ? undefined
          : `prints ${JSON.stringify([typed.printed, untyped.printed, jit.printed])}`;
      return { name, failure, typed, untyped, jit };
    } catch (error) {
      return { name, failure: String((error as Error).message) };
    } finally {
      for (const executable of Object.values(executables)) rmSync(executable, { force: true });
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
  return { names, measure };
}
