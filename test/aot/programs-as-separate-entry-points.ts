// A tenth of the programs under ./programs, another for each commit, each compiled as it is alone. programs-as-entry-points.ts joins hundreds of programs into one, so a program there can
// lean on what a neighbor names. Here the programs are the entry points of ONE executable, behind programs/run-each-in-a-worker.ts, which starts a Worker for each. An entry point begins a program of its own: the compiler makes of it what it makes of it alone, to the byte, and what
// the build reads and checks for all of them it reads and checks once. Each program runs in a global of its own. It is judged as run-programs.ts judges it: with its types and with its
// types erased it prints what it prints in a Worker of plain Bun, under the same runner, or its .expected.txt.
//
// A Worker is not the main thread (import.meta.main, process.stdin, process.chdir()), and that holds for plain Bun too. A signal ends every Worker of the process: the programs that have
// not ended by then run again, each in a process of its own, so the one that dies is named.
//
// Left out: a program that is built with flags, entry points or an environment of its own; one whose build is meant to fail; one below a tsconfig.json of its own, because the first entry
// point's governs a build; one that declares types for everybody (`declare global`, a declaration file); one with "alone" in its <program>.json; one that starts itself again as a
// child process; one whose <program>.json sets BUN_OPTIONS; and one whose <program>.json says in "mainThread" why a Worker does not print what the main thread prints.
//
//   TEST_PART=aot/every-program-alone-3 bun test test/aot/parts.test.ts   one part
//   AOT_SHARE=all TEST_PART=aot/every-program-alone bun test ..        every program
//   AOT_PROGRAMS=<text> TEST_PART=aot/every-program-alone bun test ..  the programs whose path contains the text, alone among themselves
//   AOT_PROGRAMS_LISTED=<file> ..                                      the programs that the file lists, one a line, as paths below ./programs without the extension
//   AOT_BUILD_FLAGS="--aot-validate" ..                                every build takes these flags too
//   AOT_REDS=<file> ..                                                 gets a line for each program that is red: <name>, a tab, the way, a tab, what happened
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { dirname, join, normalize, relative, sep } from "path";
import {
  besideOf,
  expectStored,
  find,
  hasTypes,
  inPrograms,
  inShare,
  isJudgedByClock,
  mayHoldWhatIsWanted,
  slot,
  spawned,
  taken,
  told,
  todoReason,
  unsupported,
  wanted,
  withoutCoreDump,
  withoutDebugInformation,
  type RunResult,
} from "./run-programs";

const runner = "run-each-in-a-worker.ts";
// Left out: a program that terminates a Worker of its own. It is written for the main thread.
const terminatesWorkers = (path: string) => readFileSync(path, "utf8").includes(".terminate(");
// A program that starts itself again as a child process starts the runner here. Its second self then runs in a Worker, which has no channel to the parent.
const startsItselfAgain = (path: string) => /\[\$~\]bun|\bcluster\.fork\(|process\.execPath, (?:Bun\.main|process\.argv\[1\])/.test(readFileSync(path, "utf8"));
// TODO: in a Worker of the executable these do not print what they print in a Worker of plain Bun, or do not end. Nobody has looked at them yet.
// AOT_PROGRAMS_LISTED=test/aot/programs-as-separate-entry-points.known.txt runs them.
const departToday = new Set(readFileSync(join(import.meta.dir, "programs-as-separate-entry-points.known.txt"), "utf8").split(/\r?\n/));
// The work that a build does once is a hundredth of the build at this number, and an image is about a megabyte.
const programsInOneExecutable = 64;
// What a Worker prints late would be taken for the next program's.
const programsInOneProcess = 1;
const mark = "=== the program above has ended with";
// Windows takes 32,767 characters.
const longestCommandLine = isWindows ? 30_000 : 1_000_000;
const redsExplained = 5;

type Options = { build?: string[]; entryPoints?: string[]; buildEnv?: object; env?: Record<string, string>; reference?: string; erased?: string; alone?: string; mainThread?: string; skipWithASAN?: string; todoOn?: Record<string, string> };
const optionsOf = (path: string): Options => (existsSync(besideOf(path) + ".json") ? JSON.parse(readFileSync(besideOf(path) + ".json", "utf8")) : {});
const nameOf = (path: string) => besideOf(inPrograms(path)).replaceAll("\\", "/");
/** The folder that stands for ./programs above the program: ./programs itself, or where the scripts have written. */
const rootOf = (path: string) => path.slice(0, path.length - inPrograms(path).length - 1);

/** Below the folder of its topic. The tsconfig.json of a topic asks for what the one above it gives. */
function hasProjectOfItsOwn(path: string): boolean {
  const topic = join(rootOf(path), inPrograms(path).split(/[\\/]/)[0]);
  for (let folder = dirname(path); folder !== topic; folder = dirname(folder)) if (existsSync(join(folder, "tsconfig.json"))) return true;
  return false;
}

function declaresForEverybody(path: string): boolean {
  if (!/[\\/]main\.[a-z]+$/.test(path)) return /\bdeclare global\b/.test(readFileSync(path, "utf8"));
  return readdirSync(dirname(path), { recursive: true, encoding: "utf8" }).some(
    name => /\.d\.[cm]?ts$/.test(name) || (/\.([cm]?ts|tsx)$/.test(name) && /\bdeclare global\b/.test(readFileSync(join(dirname(path), name), "utf8"))),
  );
}

// What a script writes has no <program>.json to say "alone" in. By how the names of a family end.
const familiesAlone = [
  // Which members of a library module an executable holds goes by what all of its entry points name.
  /^ways-into-library-modules\/.*-through-get-builtin-module-under-a-computed-key$/,
];

function canBeOneOfMany(path: string): boolean {
  const beside = besideOf(path);
  if (familiesAlone.some(family => family.test(nameOf(path)))) return false;
  if (existsSync(beside + ".todo.txt") || existsSync(beside + ".build-errors.txt")) return false;
  const { build, entryPoints, buildEnv, env, reference, alone, skipWithASAN, todoOn } = optionsOf(path);
  if (build?.length || entryPoints?.length || buildEnv || reference || alone || (isASAN && skipWithASAN) || todoReason({ todoOn })) return false;
  // Only a process reads BUN_OPTIONS, when it starts. A Worker never does.
  if (env?.BUN_OPTIONS) return false;
  return !hasProjectOfItsOwn(path) && !declaresForEverybody(path);
}

async function spawnedFor(seconds: number, cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: seconds * 1000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}

/** As an entry point is spelled for a build in `root`, and for the runner there. */
const fromRunner = (root: string, path: string) => "./" + relative(root, path).replaceAll("\\", "/");

/** Windows has several spellings for one path: either separator, either case. */
const spelledOneWay = (path: string) => (isWindows ? normalize(path.replace(/^\/(?=[a-z]:)/i, "")).toLowerCase() : path);

/** The programs that the errors of a build point into, each with the first of its errors. */
function refusedBy(stderr: string, programs: string[]): Map<string, string> {
  const refused = new Map<string, string>();
  let error: string | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    if (/^error\b/.test(line)) error = line;
    const [, file] = /^\s+at (.+):\d+:\d+$/.exec(line) ?? /^error\b.* at (\S+):\d+:\d+$/.exec(line) ?? [];
    if (!file || error === undefined) continue;
    const named = spelledOneWay(file);
    const program = programs.find(path => spelledOneWay(path) === named || (/[\\/]main\.[a-z]+$/.test(path) && named.startsWith(spelledOneWay(dirname(path) + sep))));
    if (program && !refused.has(program)) refused.set(program, `${error} ${line.trim()}`);
    error = undefined;
  }
  return refused;
}

const textOf = ({ stdout, stderr, exitCode }: RunResult) => stdout + (exitCode ? `exit code ${exitCode}\n${stderr}\n` : stderr);

function firstDifference(result: RunResult, expected: RunResult | string): string {
  const [a, b] = [textOf(result).split("\n"), (typeof expected === "string" ? expected : textOf(expected)).split("\n")];
  const line = a.findIndex((text, index) => text !== b[index]);
  return line < 0 ? `it ends at line ${a.length}` : `line ${line + 1}: ${(a[line] ?? "<end>").slice(0, 160)} | expected: ${(b[line] ?? "<end>").slice(0, 160)}`;
}

/** One way to build the programs: where each has come to lie, or why the compiler has refused it. */
class Way {
  executableOf = new Map<string, string>();
  refused = new Map<string, string>();
  /** The smallest sets of programs that were not built together, though each half of the set was, with the command that says so. */
  notBuiltTogether: string[] = [];
  #executables = 0;
  constructor(
    readonly name: string,
    readonly flags: string[],
    readonly folder: string,
    readonly carrier: string[],
  ) {}

  command(entryPoints: string[], executable: string) {
    const more = (process.env.AOT_BUILD_FLAGS ?? "").split(" ").filter(Boolean);
    return [bunExe(), "build", "--compile", "--aot", ...more, "--aot-check=validate-references", ...this.carrier, ...this.flags, ...entryPoints, "--outfile", executable];
  }

  /** The programs that the compiler refuses leave, the rest is built again, and then they among themselves. Where an error names no program the programs are built in halves. Either way down to the one. */
  async build(root: string, programs: string[]): Promise<void> {
    if (programs.length === 0) return;
    const spelled = programs.map(path => fromRunner(root, path));
    if (programs.length > programsInOneExecutable || (programs.length > 1 && spelled.join(" ").length > longestCommandLine)) return this.#buildHalves(root, programs);
    const executable = join(this.folder, `programs-${this.flags.length}-${this.#executables++}${isWindows ? ".exe" : ""}`);
    const ran = await spawnedFor(isASAN || isDebug || process.env.AOT_BUILD_FLAGS ? 1200 : 280, this.command(["./" + runner, ...spelled], executable), root);
    if (ran.exitCode === 0 && !/^error\b/m.test(ran.stderr)) {
      for (const path of programs) this.executableOf.set(path, executable);
      return;
    }
    rmSync(executable, { force: true });
    const refused = refusedBy(ran.stderr, programs);
    const said = `${ran.signal ?? `exit code ${ran.exitCode}`}: ${(/^error\b.*(?:\r?\n\s+at .*)?$/m.exec(ran.stderr)?.[0].replace(/\r?\n\s+/, " ") ?? ran.stderr.trim().split("\n").slice(-3).join(" | ")).slice(0, 600)}`;
    if (programs.length === 1) return void this.refused.set(programs[0], refused.get(programs[0]) ?? said);
    if (refused.size === 0 || refused.size === programs.length) {
      console.error(`IN HALVES: the build of ${programs.length} programs, ${this.name}, ended with ${said}`);
      const [smaller, alone] = [this.notBuiltTogether.length, this.refused.size];
      await this.#buildHalves(root, programs);
      if (smaller === this.notBuiltTogether.length && alone === this.refused.size) this.notBuiltTogether.push(`${said}\n  cd ${root} && ${this.command(["./" + runner, ...spelled], "programs").join(" ")}`);
      return;
    }
    for (const [path, error] of refused) console.error(`REFUSED among ${programs.length} programs, ${this.name}: ${nameOf(path)}: ${error}`);
    await this.build(root, programs.filter(path => !refused.has(path)));
    return this.build(root, [...refused.keys()]);
  }

  async #buildHalves(root: string, programs: string[]) {
    await this.build(root, programs.slice(0, programs.length >> 1));
    await this.build(root, programs.slice(programs.length >> 1));
  }
}

/**
 * Defines one test per program, of all folders: part `part` of `parts`, by a hash of the path, and of those one in ten, others for each commit.
 */
export function programsAsSeparateEntryPoints(part = 1, parts = 1) {
  const folder = String(tempDir("aot-entry-points", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  describe.concurrent("compile/aot/every-program-alone", () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    if (isASAN || isDebug) return void test.skip("such a build of Bun is many times slower", () => {});
    // Programs that differ in the extension alone would be written to one path of the executable: they go to different parts.
    const sameName = new Map<string, number>();
    const partOf = (path: string) => {
      const name = nameOf(path);
      const rank = sameName.get(name) ?? 0;
      sameName.set(name, rank + 1);
      return Number(((BigInt(Bun.hash(name)) >> 12n) + BigInt(rank)) % BigInt(parts));
    };
    const listed = process.env.AOT_PROGRAMS_LISTED ? new Set(readFileSync(process.env.AOT_PROGRAMS_LISTED, "utf8").split(/\r?\n/)) : undefined;
    const chosen = taken(
      find()
        // A file directly in ./programs is a helper, not a program.
        .filter(path => /[\\/]/.test(inPrograms(path)))
        .filter(path => partOf(path) === part - 1)
        .filter(mayHoldWhatIsWanted),
      path => (listed ? listed.has(nameOf(path)) : wanted === "" ? inShare("alone " + inPrograms(path), 10) : inPrograms(path).includes(wanted)),
    )
      .filter(canBeOneOfMany)
      .filter(path => !terminatesWorkers(path) && !startsItselfAgain(path) && !optionsOf(path).mainThread)
      .filter(path => listed || !departToday.has(nameOf(path)));
    if (chosen.length === 0) return void test.skip("no program selected", () => {});

    const carrier = withoutDebugInformation();
    const ways = [new Way("compiled", [], folder, carrier), new Way("compiled with types erased", ["--aot-erase-types"], folder, carrier)];
    const typed = new Set(chosen.filter(hasTypes));
    // What is kept and what the scripts have written lie below two folders. On Windows these may be on two drives, so each is built by itself there, with the runner at its top.
    const byRoot = isWindows ? Map.groupBy(chosen, rootOf) : new Map([[join(import.meta.dir, "programs"), chosen]]);
    const rootInBuild = (path: string) => (isWindows ? rootOf(path) : join(import.meta.dir, "programs"));
    for (const root of byRoot.keys()) if (!existsSync(join(root, runner))) copyFileSync(join(import.meta.dir, "programs", runner), join(root, runner));
    let built: Promise<void>[] | undefined;
    const buildOnce = (index: number) =>
      (built ??= ways.map(async (way, index) => {
        for (const [root, programs] of byRoot) await way.build(root, index === 0 ? programs : programs.filter(path => typed.has(path)));
      }))[index];

    type Ran = { stdout: string; stderr: string; exitCode: number; signal: NodeJS.Signals | null };
    let lists = 0;
    /** Starts `command`, which is the runner, for the programs, each in a Worker. What a signal or the clock has cut off runs again, a process a program. */
    async function runInWorkers(command: string[], programs: string[], spell: (path: string) => string, results: Map<string, Ran>): Promise<void> {
      const list = join(folder, `tasks-${lists++}.json`);
      writeFileSync(list, JSON.stringify(programs.map(path => ({ program: spell(path), cwd: dirname(path), env: optionsOf(path).env }))));
      const ran = await slot(() => spawned(withoutCoreDump(command), dirname(programs[0]), { ...bunEnv, BUN_AOT_VERBOSE: "1", AOT_TASKS: list, AOT_MARK: mark }));
      rmSync(list, { force: true });
      const parts = (text: string) => text.split(new RegExp(`\\r?\\n${mark} (-?[0-9]+)\\r?\\n`));
      const [stdout, stderr] = [parts(ran.stdout), parts(ran.stderr)];
      const ended = Math.min(stdout.length, stderr.length) >> 1;
      for (const [index, path] of programs.slice(0, ended).entries()) results.set(path, { stdout: stdout[2 * index], stderr: stderr[2 * index], exitCode: Number(stdout[2 * index + 1]), signal: null });
      const left = programs.slice(ended);
      if (left.length === 0) return;
      if (programs.length === 1) return void results.set(left[0], { stdout: stdout.at(-1)!, stderr: stderr.at(-1)!, exitCode: ran.exitCode, signal: ran.signal });
      console.error(`ONE BY ONE: ${left.length} of ${programs.length} programs: the process ended with ${ran.signal ?? `exit code ${ran.exitCode}`} in ${nameOf(left[0])}`);
      for (const path of left) await runInWorkers(command, [path], spell, results);
    }
    function inBatches(programs: string[], run: (batch: string[], results: Map<string, Ran>) => Promise<void>) {
      const results = new Map<string, Ran>();
      const startOf = new Map<string, () => Promise<void>>();
      for (let first = 0; first < programs.length; first += programsInOneProcess) {
        const batch = programs.slice(first, first + programsInOneProcess);
        let started: Promise<void> | undefined;
        const start = () => (started ??= run(batch, results));
        for (const path of batch) startOf.set(path, start);
      }
      return async (path: string) => (await startOf.get(path)!(), results.get(path)!);
    }
    const plainIn = inBatches(chosen, (batch, results) => runInWorkers([bunExe(), "run", join(import.meta.dir, "programs", runner)], batch, path => path, results));
    // What compares two times runs in a process of its own: the programs beside it in a batch would take its processor.
    const alone = async (cmd: string[], path: string, nameFor: (path: string) => string) => {
      const results = new Map<string, Ran>();
      await runInWorkers(cmd, [path], nameFor, results);
      return results.get(path)!;
    };
    const plainAlone = (path: string) => alone([bunExe(), "run", join(import.meta.dir, "programs", runner)], path, path => path);
    const compiledAlone = (way: (typeof ways)[number], path: string) => alone([way.executableOf.get(path)!], path, program => fromRunner(rootInBuild(program), program));
    const compiledIn = ways.map((way, index) => {
      let ask: ((path: string) => Promise<Ran>) | undefined;
      return async (path: string) => {
        await buildOnce(index);
        // The programs of one process are in one executable.
        ask ??= (() => {
          const byExecutable = Map.groupBy(way.executableOf.keys(), program => way.executableOf.get(program)!);
          const asks = new Map<string, (path: string) => Promise<Ran>>();
          for (const [executable, programs] of byExecutable) {
            const inExecutable = inBatches(programs, (batch, results) => runInWorkers([executable], batch, program => fromRunner(rootInBuild(program), program), results));
            for (const program of programs) asks.set(program, inExecutable);
          }
          return (program: string) => asks.get(program)!(program);
        })();
        return ask(path);
      };
    });

    let explained = 0;
    const says = (path: string, way: Way, what: string) => {
      if (process.env.AOT_REDS) appendFileSync(process.env.AOT_REDS, `${nameOf(path)}\t${way.name}\t${what.replaceAll("\n", " | ").slice(0, 300)}\n`);
      const topic = nameOf(path).split("/")[0];
      const file = existsSync(join(import.meta.dir, `${topic}.test.ts`)) ? `test/aot/${topic}.test.ts` : `test/aot/parts.test.ts`;
      console.error(`RED: ${nameOf(path)}, ${way.name}, one of ${way.executableOf.size} entry points: ${what}\n  alone: AOT_PROGRAMS=${nameOf(path)} TEST_PART=aot/${topic} bun test ${file}`);
    };
    /** Does the program do the same when it is the only one in its executable? */
    async function explain(path: string, way: Way, judge: (result: RunResult) => void) {
      if (explained++ >= redsExplained) return;
      const executable = join(folder, `alone-${explained}${isWindows ? ".exe" : ""}`);
      const build = await spawnedFor(240, way.command([path], executable), dirname(path));
      let verdict = `the build ends with ${build.signal ?? `exit code ${build.exitCode}`}`;
      if (build.exitCode === 0) {
        const ran = await spawned(withoutCoreDump([executable]), dirname(path), { ...bunEnv, ...optionsOf(path).env });
        try {
          expect(ran.signal).toBeNull();
          judge(told(ran));
          verdict = `it does what is expected. If that is right, say why in "alone" of ${nameOf(path)}.json`;
        } catch {
          verdict = "it is red too";
        }
      }
      rmSync(executable, { force: true });
      console.error(`  ${nameOf(path)}, ${way.name}, built alone: ${verdict}`);
    }

    // Entry points that are built one by one and not together are a valid program that the compiler refuses.
    test(
      "the programs are built together",
      async () => {
        await Promise.all(ways.map((_, index) => buildOnce(index)));
        expect(ways.flatMap(way => way.notBuiltTogether)).toEqual([]);
      },
      1_500_000,
    );

    for (const path of chosen) {
      test(
        nameOf(path),
        async () => {
          const options = optionsOf(path);
          const comparesTimes = isJudgedByClock(path);
          let reference: RunResult | undefined;
          for (const [index, way] of ways.entries()) {
            if (index === 1 && !typed.has(path)) continue;
            const stored = index === 1 && options.erased ? "" : besideOf(path) + ".expected.txt";
            if (!existsSync(stored) && !reference) {
              const plain = await (comparesTimes ? plainAlone(path) : plainIn(path));
              const hasFailed = plain.signal !== null || plain.exitCode !== 0;
              expect({ signal: plain.signal, exitCode: plain.exitCode, stderr: hasFailed ? plain.stderr : "" }).toEqual({ signal: null, exitCode: 0, stderr: "" });
              reference = told(plain);
            }
            const judge = (result: RunResult) => (existsSync(stored) ? expectStored(stored, result) : expect({ way: way.name, ...result }).toEqual({ way: way.name, ...reference! }));
            await buildOnce(index);
            let happened = "it did not start";
            try {
              expect({ way: way.name, refused: way.refused.get(path) }).toEqual({ way: way.name, refused: undefined });
              // Other work on the machine moves a ratio of two times for a while, so what compares times is asked up to four times. Code that is slower is slower each time.
              for (let attemptsLeft = comparesTimes ? 3 : 0; ; attemptsLeft--) {
                const ran = await (comparesTimes ? compiledAlone(way, path) : compiledIn[index](path));
                const result = told({ ...ran, stderr: ran.stderr.replace(/^\[aot\] .*\r?\n/gm, "") });
                happened = ran.signal ?? firstDifference(result, existsSync(stored) ? readFileSync(stored, "utf8") : reference!);
                expect({ way: way.name, signal: ran.signal, stderr: ran.signal ? ran.stderr : "" }).toEqual({ way: way.name, signal: null, stderr: "" });
                // The executable really ran compiled code and did not fall back to the embedded source.
                expect(ran.stderr).toContain("[aot] module: ");
                try {
                  judge(result);
                  break;
                } catch (error) {
                  if (attemptsLeft === 0) throw error;
                  console.error(`ASKED AGAIN: ${nameOf(path)}, ${way.name}: ${happened}`);
                  if (!existsSync(stored)) reference = told(await plainAlone(path));
                }
              }
            } catch (error) {
              says(path, way, way.refused.get(path) ?? happened);
              await slot(() => explain(path, way, judge));
              throw error;
            }
          }
        },
        1_500_000,
      );
    }
  });
}
