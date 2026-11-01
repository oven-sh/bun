// Measures one idiom of ./idioms or ./everyday three ways: compiled ahead of time as TypeScript and as JavaScript, and the same JavaScript under the same binary's JIT.
// ./idioms-against-the-jit.ts says how, and prints the table; ./idioms-against-the-jit.test.ts holds each idiom against a bound.
import { existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { measureCommand, measureCommandWithMemory } from "../analysis-scaling/measure-check";
import { flagsOfVeryLargeProgram, writeEverydayIdioms } from "./everyday-idioms";
import { writeTypedIdioms, writeUntypedIdioms } from "./untyped-idioms";

type Turns = { turns: number; warmUp: number };
export type Cost = {
  instructions: number;
  collections: number;
  peakMegabytes: number;
  peakMegabytesOfShortRun: number;
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

/**
 * A turn's cost can come in lumps. names-seen.one-of-256-lists-of-40-by-in (./everyday/dictionaries-built-anew.txt) takes 7,000 instructions a turn, plus 80 million every 9,000 turns: a full
 * collection frees the 10,240 structures of its dictionaries, and the next 256 turns build them again. The two runs of a reading are 750 million instructions apart. That holds five of those
 * lumps or six, depending on where the runs end, and every plan ends them somewhere else: one executable read 14,100 to 16,400 a turn.
 * `count(part)` is the instructions of a run of `part` sixty-fourths of the planned turns, for each of `partsThatShowLumps`. Three adjacent stretches of equal length cost the same except for
 * the lumps in them, and lumps that are 1.5 to 3 stretches apart never fall evenly. Stretches of 1, 2 and 4 sixty-fourths catch the lumps that come 4 to 32 times between the two runs.
 * Returns the factor on the planned turns that makes one lump less than 1% of what lies between the two runs, which are 48 sixty-fourths apart.
 */
export function timesThatEvenOutLumps(count: (part: number) => number) {
  const lump = Math.max(
    ...[1, 2, 4].map(width => {
      const stretches = [1, 2, 3].map(stretch => count((stretch + 1) * width) - count(stretch * width));
      return Math.max(...stretches) - Math.min(...stretches);
    }),
  );
  return Math.max(1, Math.ceil((100 * lump) / (4 * (count(16) - count(4)))));
}
export const partsThatShowLumps = [1, 2, 3, 4, 6, 8, 12, 16];

/**
 * The two runs of a reading. A run of `turns` against a run of a quarter of them measures the turns in between only if both run the same code. Compiled code asks in front of a counted loop
 * whether it has over 2 ** 20 turns (`Limits::maxTurnsWithoutPoll` in b3/B3Limits.h of the engine). If so, all of its turns run in a copy of the loop that lets the collector stop it. With the short run
 * in the loop and the long run in the copy, a copy that takes 11 instructions a turn for the loop's 8 reads 12, which no run of any length takes. So both runs lie on one side, within the turns
 * that were planned, and the short one is about half of the long one at most.
 * The question is about the turns that are left: a loop whose first turn stands in front of it takes 2 ** 20 + 1 turns without the copy. So a run that is to take the copy has 4,096 turns more.
 */
export const mostTurnsOfLoopWithoutCopy = 2 ** 20;
export const fewestTurnsThatTakeTheCopy = mostTurnsOfLoopWithoutCopy + 4096;
export function runsOfReading(turns: number) {
  const quarter = turns >> 2;
  if (turns <= mostTurnsOfLoopWithoutCopy || quarter >= fewestTurnsThatTakeTheCopy) return { short: quarter, long: turns };
  if (turns <= 2 * mostTurnsOfLoopWithoutCopy) return { short: quarter, long: mostTurnsOfLoopWithoutCopy };
  return { short: fewestTurnsThatTakeTheCopy, long: turns };
}

/** How many turns each of the hundred short calls of ./idioms/host.ts takes. Only the JIT needs them: ten million instructions a call. ./README.md, "How many turns a number needs". */
export function turnsOfCallThatWarmsUp({
  aTurn,
  waits,
  underTheJit,
}: {
  aTurn: number;
  waits: boolean;
  underTheJit: boolean;
}) {
  if (!underTheJit) return 1;
  return Math.round(Math.min(5000, Math.max(100, waits ? 0 : 10e6 / aTurn)));
}

/**
 * Whether a turn mostly waits, for a timer say. The clock alone cannot tell: a busy machine keeps a program that only computes from running for seconds. A program that waits gives up the
 * processor, once a turn or more. One that is kept from running has it taken away. `timesATurnItGivesUpTheProcessor` is NaN where nothing counts that: there the clock decides.
 */
export function mostlyWaits({
  aTurn,
  secondsATurn,
  timesATurnItGivesUpTheProcessor,
}: {
  aTurn: number;
  secondsATurn: number;
  timesATurnItGivesUpTheProcessor: number;
}) {
  return secondsATurn > 500e-6 && secondsATurn > (20 * aTurn) / 1e9 && !(timesATurnItGivesUpTheProcessor < 0.5);
}

/**
 * As many turns as make 800 million instructions, and more where the cost comes in lumps. A turn that mostly waits executes little: of those, as many as take twenty seconds.
 * Too few turns would leave the JIT's compiling inside what is measured. `count` runs the program.
 */
export async function planOf(
  count: (plan: Turns) => Promise<{ instructions: number; seconds: number; timesItGaveUpTheProcessor: number }>,
  { underTheJit }: { underTheJit: boolean },
): Promise<Turns> {
  const few = await count({ turns: 1000, warmUp: 20 });
  const more = await count({ turns: 5000, warmUp: 20 });
  const aTurn = Math.max(1, (more.instructions - few.instructions) / 4000);
  const secondsATurn = (more.seconds - few.seconds) / 4000;
  const timesATurnItGivesUpTheProcessor = (more.timesItGaveUpTheProcessor - few.timesItGaveUpTheProcessor) / 4000;
  const waits = mostlyWaits({ aTurn, secondsATurn, timesATurnItGivesUpTheProcessor });
  const turns = Math.round(Math.min(20e6, Math.max(8000, waits ? 20 / secondsATurn : 800e6 / aTurn)));
  const warmUp = turnsOfCallThatWarmsUp({ aTurn, waits, underTheJit });
  if (waits) return { turns, warmUp };
  const counts = new Map<number, number>();
  for (const part of partsThatShowLumps)
    counts.set(part, (await count({ turns: part * (turns >> 6), warmUp: 20 })).instructions);
  return { turns: turns * timesThatEvenOutLumps(part => counts.get(part)!), warmUp };
}

/**
 * Writes every idiom's sources into `folder`: the TypeScript into one folder with a tsconfig.json, the JavaScript into another without. `collections: false` leaves out the run that counts them; `buildFlags` go to every `bun build --compile --aot`.
 * `inVeryLargeProgram` compiles each idiom as the same text would be compiled inside a very large program, and the idioms of ./everyday find turn() at run time.
 * `jit: false` leaves out the runs under the JIT, and the warming up that only they need. `together` names the idioms that will be measured: they are the entry points of a few executables, each compiled as it is when it is built alone.
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
    process.platform === "linux" && existsSync("/usr/bin/time")
      ? ["/usr/bin/time", "-f", "peak %M\n%w voluntary context switches"]
      : [];

  async function counted(cmd: string[], { turns, warmUp }: Turns, extra: Record<string, string> = {}) {
    const began = performance.now();
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
      seconds: (performance.now() - began) / 1000,
      // As GNU time is told to print it above, and as `time -l` of macOS prints it.
      timesItGaveUpTheProcessor: Number(/^\s*(\d+) +voluntary context switches$/m.exec(stderr)?.[1]),
      peakMegabytes: peakKilobytes / 1024,
      printed: stdout,
      collections: stderr.match(/^.*GC\b.*$/gm)?.length ?? 0,
    };
  }

  async function cost(cmd: string[], plan: Turns, extra: Record<string, string> = {}): Promise<Cost> {
    const runs = runsOfReading(plan.turns);
    const short = await counted(cmd, { ...plan, turns: runs.short }, extra);
    const long = await counted(cmd, { ...plan, turns: runs.long }, extra);
    const logged = collections
      ? await counted(cmd, { ...plan, turns: runs.long }, { ...extra, BUN_JSC_logGC: "1" })
      : { collections: 0 };
    return {
      instructions: Math.max(0.5, (long.instructions - short.instructions) / (runs.long - runs.short)),
      collections: logged.collections,
      peakMegabytes: long.peakMegabytes,
      peakMegabytesOfShortRun: short.peakMegabytes,
      printed: long.printed,
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
          ? { turns: pinnedTurns[name], warmUp: measuresJit ? 5000 : 1 }
          : await planOf(plan => counted([executables.untyped], plan, startsAt("untyped")), {
              underTheJit: measuresJit,
            });
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
