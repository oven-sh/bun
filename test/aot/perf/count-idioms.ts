// What a thousand turns of an idiom of ./idioms or ./everyday do beside the straight path, counted by the executable itself: no clock and no counter of the processor, so the same on every machine.
// ./pinned-everyday-idioms.ts counts instructions, which the machines of CI cannot. A method that was called directly and is now looked up by name costs three times the instructions,
// and it is also an event: `--aot-count-arrivals` counts it.
//
//   bun test/aot/perf/count-idioms.ts <the Bun that builds> <where the counts go, as JSON> [a pattern for the names] [in-a-very-large-program] [flags for every build ..]
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { availableParallelism, tmpdir } from "os";
import { join } from "path";
import { flagsOfVeryLargeProgram, writeEverydayIdioms } from "./everyday-idioms";
import { writeTypedIdioms, writeUntypedIdioms } from "./untyped-idioms";

export const forms = ["typed", "untyped"] as const;
export type Form = (typeof forms)[number];
/** What stands around turn(): ./everyday-idioms.ts. */
export type Surroundings = "ordinary" | "called-once" | "in-a-very-large-program";
/** For `turnsCounted` turns. */
export type Counts = {
  /** Reads, stores and calls that look a name up. */
  arrivals: number;
  /** Calls into the run time, without `refills`. */
  operations: number;
  /** Two-way branches of compiled code that ran. */
  branches: number;
  /** What compiled code and its stubs allocate. */
  cells: number;
  bytes: number;
  /**
   * What anybody allocates while the program runs, the run time included: the lists of free cells that were used up, less what was left in the lists in use.
   * Where an allocation moves between the run time and compiled code, `cells` and `bytes` move and these do not.
   */
  allCells: number;
  allBytes: number;
  /** What the run time counts of its own accord: guards cleared, caches filled again, stubs that gave up, names not found where they were expected. */
  events: number;
};
export const kinds = ["arrivals", "operations", "branches", "cells", "bytes", "allCells", "allBytes", "events"] as const;
/**
 * `refills`: the calls into the run time that fetched an allocator a new list of free cells. How long a list is differs between builds and platforms. Such a call came for that alone, or
 * is one that the program makes anyway and found the list empty on its way: the counts do not tell. So the program makes at least `operations` calls and at most that and `refills`.
 */
export type Counted = { counts: Counts; refills: number; lines: Map<string, number>; printed: string };

export const turnsCounted = 1000;
const idiomsInOneExecutable = 128;
const extensions = { typed: ".ts", untyped: ".js" };

/** Each line of the file that BUN_JSC_aotCountsPath names, under what it counts. */
export function linesOf(text: string) {
  const lines = new Map<string, number>();
  const add = (name: string, count: number) => lines.set(name, (lines.get(name) ?? 0) + count);
  for (const line of text.split("\n")) {
    if (line.startsWith("allocation ")) {
      const words = line.split(" ");
      add(`cells:${words.slice(1, -2).join(" ")}`, Number(words.at(-2)));
      add(`bytes:${words.slice(1, -2).join(" ")}`, Number(words.at(-1)));
      continue;
    }
    if (line.startsWith("refill ")) {
      const words = line.split(" ");
      const sign = words[2] === "list_in_use" ? -1 : 1;
      add(`allCells:${words.at(-3)}`, sign * Number(words.at(-2)));
      add(`allBytes:${words.at(-3)}`, sign * Number(words.at(-1)));
      continue;
    }
    const [count, ...name] = line.split("\t");
    if (name.length) add(name.join(" "), Number(count));
  }
  return lines;
}

const kindOfLine = (name: string): keyof Counts | undefined =>
  name.startsWith("arrival:")
    ? "arrivals"
    : name.startsWith("operation:")
      ? "operations"
      : name.startsWith("branch:")
        ? "branches"
        : name.startsWith("cells:")
          ? "cells"
          : name.startsWith("bytes:")
            ? "bytes"
            : name.startsWith("allCells:")
              ? "allCells"
              : name.startsWith("allBytes:")
                ? "allBytes"
                : /^(?:counter|exit|named):/.test(name)
              ? "events"
              : undefined;

/** How arrivals are counted is no call that the program makes. */
const countsTheCounting = (name: string) => name.endsWith(":operationAOTRecordArrival");

/** What the longer of two runs counted beyond the shorter. */
export function difference(short: Map<string, number>, long: Map<string, number>) {
  const lines = new Map<string, number>();
  for (const name of new Set([...short.keys(), ...long.keys()])) {
    const more = (long.get(name) ?? 0) - (short.get(name) ?? 0);
    if (more) lines.set(name, more);
  }
  const counts: Counts = { arrivals: 0, operations: 0, branches: 0, cells: 0, bytes: 0, allCells: 0, allBytes: 0, events: 0 };
  let refills = 0;
  for (const [name, more] of lines) {
    if (countsTheCounting(name)) continue;
    if (name.startsWith("refilled:")) refills += more;
    const kind = kindOfLine(name);
    if (kind) counts[kind] += more;
  }
  counts.operations -= refills;
  return { counts, refills, lines };
}

/** The lines of one kind that make up a count, the largest first, without the branches: their numbers say nothing to a reader. */
export function whatWasCounted(lines: Map<string, number>, most = 12) {
  return [...lines]
    .filter(([name]) => kindOfLine(name) && !name.startsWith("branch:") && !name.startsWith("bytes:") && !name.startsWith("allBytes:") && !countsTheCounting(name))
    .sort(([, first], [, second]) => second - first)
    .slice(0, most)
    .map(([name, count]) => `${count} ${name}`);
}

/**
 * The idioms that `chosen` picks are the entry points of a few executables, each compiled as it is when it is built alone. `start()` says which of them a run starts.
 * With `marks` each program sends itself a signal in front of the long call and behind it, for ./count-steps.ts, without which the signal ends it. Only these programs have the marks:
 * they name a function of native code that the compiler knows nothing about, and one idiom in a thousand is compiled otherwise beside it.
 * "called-once" and "in-a-very-large-program" are the idioms of ./everyday alone, in that form (./everyday-idioms.ts): the programs of ./idioms write their own loops.
 * In the first the long call is the only one: nothing warms up. The second is built with `flagsOfVeryLargeProgram`.
 */
export function idiomsInExecutables(
  bun: string,
  folder: string,
  chosen: (names: string[]) => string[],
  buildFlags: string[] = [],
  marks = false,
  surroundings: Surroundings = "ordinary",
) {
  const benchIsCalledOnce = surroundings === "called-once";
  const inVeryLargeProgram = surroundings === "in-a-very-large-program";
  if (inVeryLargeProgram) buildFlags = [...flagsOfVeryLargeProgram, ...buildFlags];
  const sources = { typed: join(folder, "idioms"), untyped: join(folder, "untyped-idioms") };
  writeTypedIdioms(sources.typed);
  writeUntypedIdioms(sources.untyped);
  for (const form of marks ? forms : []) {
    const host = join(sources[form], "host.ts");
    const head = "export function nextTurns(_check: number): number {";
    const text = readFileSync(host, "utf8");
    if (!text.includes(head)) throw new Error(`${host} has no line \`${head}\``);
    writeFileSync(host, text.replace(head, `${head}\n  if (plan.length <= 1) process.kill(process.pid, "SIGUSR2");`));
  }
  for (const form of benchIsCalledOnce ? forms : []) {
    const host = join(sources[form], "host.ts");
    const rounds = "new Array(100).fill(Number(process.env.AOT_PERF_WARM_UP_TURNS ?? 5000))";
    const text = readFileSync(host, "utf8");
    if (!text.includes(rounds)) throw new Error(`${host} does not say \`${rounds}\``);
    writeFileSync(host, text.replace(rounds, "[]"));
  }
  const names = chosen(
    [
      ...readdirSync(join(import.meta.dir, "idioms"), { recursive: true })
        .map(String)
        .filter(path => surroundings === "ordinary" && path.endsWith(".ts") && path !== "host.ts")
        .map(path => path.slice(0, -3).replaceAll("\\", "/")),
      ...writeEverydayIdioms(sources.typed, sources.untyped, inVeryLargeProgram, benchIsCalledOnce),
    ].sort(),
  );
  // A collection drops what the run time has learned about some places, and when one comes depends on the clock.
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
    BUN_JSC_smallHeapSize: "2000000000",
    BUN_JSC_largeHeapSize: "2000000000",
  };
  const environmentOfBuilds: Record<string, string> = buildFlags.some(flag => flag.startsWith("--aot-testing=")) ? { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" } : {};

  async function run(cwd: string, cmd: string[], extra: Record<string, string> = {}) {
    await using child = Bun.spawn({
      cmd,
      cwd,
      env: { ...environment, ...extra },
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
    return { stdout, stderr };
  }

  const built = new Map<string, Promise<string>>();
  function executableOf(form: Form, name: string) {
    const first = Math.floor(names.indexOf(name) / idiomsInOneExecutable) * idiomsInOneExecutable;
    const executable = join(folder, `${form}-from-${first}`);
    if (!built.has(executable))
      built.set(
        executable,
        run(
          sources[form],
          [
            bun,
            "build",
            "--compile",
            "--aot",
            "--aot-separate-programs",
            `--root=${sources[form]}`,
            ...buildFlags,
            ...names.slice(first, first + idiomsInOneExecutable).map(name => join(sources[form], name + extensions[form])),
            "--outfile",
            executable,
          ],
          environmentOfBuilds,
        ).then(() => executable),
      );
    return built.get(executable)!;
  }

  return {
    names,
    run,
    executableOf,
    start: (form: Form, name: string, turns: number) => ({ BUN_AOT_START_AT: name + extensions[form], AOT_PERF_WARM_UP_TURNS: "10", AOT_PERF_TURNS: String(turns) }),
    startBuilds: () => names.forEach((name, index) => index % idiomsInOneExecutable || forms.forEach(form => executableOf(form, name).catch(() => {}))),
  };
}

export function countedIdioms(bun: string, folder: string, chosen: (names: string[]) => string[], buildFlags: string[] = [], surroundings: Surroundings = "ordinary") {
  const { names, run, executableOf, start, startBuilds } = idiomsInExecutables(bun, folder, chosen, ["--aot-count-arrivals", "--aot-count-branches", ...buildFlags], false, surroundings);
  mkdirSync(join(folder, "counts"), { recursive: true });

  async function count(name: string, form: Form): Promise<Counted> {
    const executable = await executableOf(form, name);
    const runOf = async (turns: number) => {
      const path = join(folder, "counts", `${name.replaceAll("/", "-")}-${form}-${turns}`);
      const { stdout: printed } = await run(folder, [executable], { ...start(form, name, turns), BUN_JSC_aotCountsPath: path });
      const lines = linesOf(readFileSync(path, "utf8"));
      rmSync(path, { force: true });
      return { printed, lines };
    };
    const [short, long] = await Promise.all([runOf(turnsCounted), runOf(2 * turnsCounted)]);
    return { ...difference(short.lines, long.lines), printed: long.printed };
  }

  return { names, count, startBuilds };
}

if (import.meta.main) {
  const [bun, out, pattern = ".", ...buildFlags] = process.argv.slice(2);
  const surroundings: Surroundings = buildFlags[0] === "in-a-very-large-program" ? (buildFlags.shift() as Surroundings) : "ordinary";
  const folder = join(process.env.TMPDIR ?? tmpdir(), `count-idioms-${process.pid}`);
  mkdirSync(folder, { recursive: true });
  const { names, count } = countedIdioms(bun, folder, all => all.filter(name => new RegExp(pattern).test(name)), buildFlags, surroundings);
  const result: Record<string, Partial<Record<Form, Counts & { refills: number; what: string[] }>> & { failure?: string }> = {};
  const waiting = names.flatMap(name => forms.map(form => ({ name, form })));
  await Promise.all(
    Array.from({ length: Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism() }, async () => {
      for (let next = waiting.shift(); next; next = waiting.shift()) {
        const { name, form } = next;
        try {
          const { counts, refills, lines } = await count(name, form);
          (result[name] ??= {})[form] = { ...counts, refills, what: whatWasCounted(lines) };
        } catch (error) {
          (result[name] ??= {}).failure = `${form}: ${(error as Error).message}`;
        }
      }
    }),
  );
  writeFileSync(out, JSON.stringify(Object.fromEntries(Object.entries(result).sort()), null, 1) + "\n");
  rmSync(folder, { recursive: true, force: true });
  console.log(`${names.length} idioms, ${Object.values(result).filter(row => row.failure).length} failed`);
}
