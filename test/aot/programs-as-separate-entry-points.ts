// A quarter of the programs under ./programs, another each day, each compiled as it is alone. What --aot proves about a program it proves while it has seen all the code that can ever run.
// programs-as-entry-points.ts joins hundreds of programs into one behind an import() of a computed name: that build has not seen all the code, and a program there can lean on what a
// neighbor names. Here the programs are the entry points of ONE executable, behind programs/run-each-in-a-worker.ts, which starts a Worker for each. An entry point begins a program of its
// own: the compiler makes of it what it makes of it alone, to the byte, and what the build reads and checks for all of them it reads and checks once. Each program runs in a global of its
// own. It is judged as run-programs.ts judges it: with its types and with its types erased it prints what it prints in a Worker of plain Bun, under the same runner, or its .expected.txt.
//
// A Worker is not the main thread (import.meta.main, process.stdin, process.chdir()), and that holds for plain Bun too.
//
// An entry point that may load any module is one program with every entry point that is built with it. So a program that is written that way (fuzz/the-world-is-open.ts) has an executable
// of its own, with nothing in front of it, and runs on the main thread, held to plain Bun on the main thread. The build has the say: its report tells how often the compiler has run, and
// where that is not once for the runner and once for each program, the programs that the report names are built alone, or else the halves are built, until it is. The line `WORLD:` has
// the numbers. Built alone as well: a program below a tsconfig.json of its own, because the first entry point's governs a build; one that declares types for everybody (`declare global`, a
// declaration file); one with "alone" in its <program>.json; one that terminates a Worker of its own, asks isMainThread what to do or starts itself again as a child process; one whose <program>.json sets BUN_OPTIONS;
// and one whose <program>.json says in "mainThread" why a Worker does not print what the main thread prints.
//
// Left out: a program that is built with flags, entry points or an environment of its own, one that is not compared with plain Bun, and one whose build is meant to fail.
//
// A program by itself costs thirteen times the processor time of a program among hundreds, so a run takes a quarter. Which one goes by the day and by the lane of CI: in four days a lane has
// taken every program, and the two lanes that run every file have in two. macOS, which has the fewest machines, takes a tenth. AOT_SHARE=all takes all.
//
//   TEST_PART=aot/every-program-alone-3 bun test test/aot/parts.test.ts   one part
//   AOT_SHARE=all TEST_PART=aot/every-program-alone bun test ..        every program
//   AOT_PROGRAMS=<text> TEST_PART=aot/every-program-alone bun test ..  the programs whose path contains the text
//   AOT_PROGRAMS_LISTED=<file> ..                                      the programs that the file lists, one a line, as paths below ./programs without the extension, up to a tab
//   AOT_BUILD_FLAGS="--aot-validate" ..                                every build takes these flags too
//   AOT_PLAIN_BUN=<path> ..                                            the Bun that says what is expected, in place of the one that is tested
//   AOT_REDS=<file> ..                                                 gets a line for each program that is red: <name>, a tab, the way, a tab, what happened
//   AOT_OPENS=<file> ..                                                gets a line for each program that may run code that its build has not seen: <name>, a tab, the way, a tab, what the build says
//   AOT_LEFT_OUT=<file> ..                                             gets a line for each program that is left out: <name>, a tab, why
//   AOT_GROUPS=<file> ..                                               gets a line for each executable with many programs: the way, a tab, their names
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS, isWindows, tempDir } from "harness";
import { dirname, join, normalize, relative, resolve, sep } from "path";
import { shareNumber } from "./fresh-seed";
import { opensTheWorld } from "./fuzz/the-world-is-open";
import {
  besideOf,
  expectStored,
  find,
  hasTypes,
  inPrograms,
  isToldWhatToTake,
  mayHoldWhatIsWanted,
  measuresTimeOrMemory,
  referenceEnv,
  slot,
  spawned,
  taken,
  takesWhatIsDrawn,
  told,
  todoReason,
  unsupported,
  wanted,
  withEverySlot,
  withoutCoreDump,
  withoutDebugInformation,
  type RunResult,
} from "./run-programs";

const runner = "run-each-in-a-worker.ts";
const plainBun = process.env.AOT_PLAIN_BUN ?? bunExe();
// It is written for the main thread.
const terminatesWorkers = (path: string) => readFileSync(path, "utf8").includes(".terminate(");
const asksWhichThreadItIsOn = (path: string) => /\bisMainThread\b/.test(readFileSync(path, "utf8"));
// A program that starts itself again as a child process starts the runner here. Its second self then runs in a Worker, which has no channel to the parent.
const startsItselfAgain = (path: string) => /\[\$~\]bun|\bcluster\.fork\(|process\.execPath, (?:Bun\.main|process\.argv\[1\])/.test(readFileSync(path, "utf8"));
// TODO: these do not print here what is expected of them. Each line has the program, a tab and what happens today, and each is a todo:
// `bun test --todo` runs them, and so does AOT_PROGRAMS_LISTED=test/aot/programs-as-separate-entry-points.known.txt.
const departToday = new Map(
  readFileSync(join(import.meta.dir, "programs-as-separate-entry-points.known.txt"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => line.split("\t") as [string, string]),
);
// The work that a build does once is a hundredth of the build at this number, and an image is about a megabyte.
const programsInOneExecutable = 64;
const mark = "=== the program above has ended with";
// Windows takes 32,767 characters.
const longestCommandLine = isWindows ? 30_000 : 1_000_000;
const redsExplained = 5;
const mostGroupsAtOnce = 12;
const oneIn = isMacOS ? 10 : 4;
const today = Math.floor(Date.now() / 86_400_000);
const isInShareOfToday = (name: string) => Number(BigInt(Bun.hash("alone " + name)) % BigInt(oneIn)) === (shareNumber + today) % oneIn;

type Options = { build?: string[]; entryPoints?: string[]; buildEnv?: object; env?: Record<string, string>; reference?: string; erased?: string; alone?: string; mainThread?: string; skipWithASAN?: string; todoOn?: Record<string, string> };
const optionsOf = (path: string): Options => (existsSync(besideOf(path) + ".json") ? JSON.parse(readFileSync(besideOf(path) + ".json", "utf8")) : {});
const nameOf = (path: string) => besideOf(inPrograms(path)).replaceAll("\\", "/");
// Bun reads its feature flags from the environment of the process. What a Worker is given in `env` doesn't set them.
const processEnvOf = (path: string) => Object.fromEntries(Object.entries(optionsOf(path).env ?? {}).filter(([name]) => name.startsWith("BUN_FEATURE_FLAG_")));
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

// A file directly in ./programs is a helper, and a program that names one holds its text.
const helpersThatMayLoadAnything = readdirSync(join(import.meta.dir, "programs"), { withFileTypes: true })
  .filter(entry => entry.isFile() && /\.([cm]?[jt]s|[jt]sx)$/.test(entry.name) && opensTheWorld(readFileSync(join(import.meta.dir, "programs", entry.name), "utf8")))
  .map(entry => entry.name);

/** Whether the program is written as one that may load any module. It only sorts: the build has the say. */
function mayLoadAnything(path: string): boolean {
  const texts = /[\\/]main\.[a-z]+$/.test(path)
    ? readdirSync(dirname(path), { recursive: true, encoding: "utf8" })
        .filter(name => /\.([cm]?[jt]s|[jt]sx)$/.test(name))
        .map(name => readFileSync(join(dirname(path), name), "utf8"))
    : [readFileSync(path, "utf8")];
  return texts.some(text => opensTheWorld(text) || helpersThatMayLoadAnything.some(helper => text.includes(helper)));
}

// What a script writes has no <program>.json to say "alone" in. By how the names of a family end.
const familiesAlone = [
  // Which members of a library module an executable holds goes by what all of its entry points name.
  /^ways-into-library-modules\/.*-through-get-builtin-module-under-a-computed-key$/,
];

/** Why nothing here builds the program: run-programs.ts knows how. */
function whyLeftOut(path: string): string | undefined {
  const beside = besideOf(path);
  if (existsSync(beside + ".todo.txt")) return "it is a todo";
  if (existsSync(beside + ".build-errors.txt")) return "its build is meant to fail";
  const { build, entryPoints, buildEnv, reference, skipWithASAN, todoOn } = optionsOf(path);
  if (build?.length) return "it is built with flags of its own";
  if (entryPoints?.length) return "it has entry points of its own";
  if (buildEnv) return "it is built in an environment of its own";
  if (reference) return "it is not compared with plain Bun";
  if (isASAN && skipWithASAN) return skipWithASAN;
  if (todoReason({ todoOn })) return "it is a todo here";
  return undefined;
}

/** Why the program is not one of many entry points that run in Workers, but has an executable of its own and runs on the main thread. */
function whyAlone(path: string): string | undefined {
  if (familiesAlone.some(family => family.test(nameOf(path)))) return "its family is built alone";
  const { env, alone, mainThread } = optionsOf(path);
  if (alone) return `alone: ${alone}`;
  if (mainThread) return `mainThread: ${mainThread}`;
  // Only a process reads BUN_OPTIONS, when it starts. A Worker never does.
  if (env?.BUN_OPTIONS) return "it sets BUN_OPTIONS";
  // The first entry point's governs a build.
  if (hasProjectOfItsOwn(path)) return "it lies below a tsconfig.json of its own";
  if (declaresForEverybody(path)) return "it declares types for everybody";
  if (terminatesWorkers(path)) return "it terminates a Worker of its own";
  if (asksWhichThreadItIsOn(path)) return "it asks isMainThread what to do";
  if (startsItselfAgain(path)) return "it starts itself again";
  // It would be one program with every entry point that is built with it.
  if (mayLoadAnything(path)) return "it is written as a program that may load any module";
  return undefined;
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

const whatABuildSaid = (ran: { stderr: string; exitCode: number; signal: number | NodeJS.Signals | null }) =>
  `${ran.signal ?? `exit code ${ran.exitCode}`}: ${(/^error\b.*(?:\r?\n\s+at .*)?$/m.exec(ran.stderr)?.[0].replace(/\r?\n\s+/, " ") ?? ran.stderr.trim().split("\n").slice(-3).join(" | ")).slice(0, 600)}`;

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
  /** The internal errors that the compiler reported for a program among others. The program is then built apart from them, so its own test does not tell. */
  internalErrors: string[] = [];
  /** The programs that are built alone, and run on the main thread. */
  alone = new Set<string>();
  /** Those of them that may run code that the build has not seen, each with what the build says of it. */
  opens = new Map<string, string>();
  builds = 0;
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

  remove(programs: string[]) {
    for (const path of programs) if (this.executableOf.has(path)) rmSync(this.executableOf.get(path)!, { force: true });
  }

  #read(report: string) {
    const { unseenCode, statistics } = JSON.parse(readFileSync(report, "utf8")) as {
      unseenCode: { cause: string; builtin: string | null; location: { file: string; line: number; column: number } | null }[];
      statistics: { EngineRuns: number };
    };
    rmSync(report, { force: true });
    return { unseenCode, engineRuns: statistics.EngineRuns };
  }

  #limit = isASAN || isDebug || process.env.AOT_BUILD_FLAGS ? 1200 : 280;

  async buildAlone(path: string): Promise<void> {
    const executable = join(this.folder, `programs-${this.flags.length}-${this.#executables++}${isWindows ? ".exe" : ""}`);
    const report = executable + ".json";
    this.builds++;
    this.alone.add(path);
    const ran = await slot(() => spawnedFor(this.#limit, this.command([`--aot-report=${report}`, "--aot-report-detail=summary", path], executable), dirname(path)));
    if (ran.exitCode !== 0 || /^error\b/m.test(ran.stderr)) {
      rmSync(report, { force: true });
      rmSync(executable, { force: true });
      return void this.refused.set(path, refusedBy(ran.stderr, [path]).get(path) ?? whatABuildSaid(ran));
    }
    const { unseenCode } = this.#read(report);
    if (unseenCode.length) this.opens.set(path, [...new Set(unseenCode.map(({ cause, builtin }) => `${cause}${builtin ? ` ${builtin}` : ""}`))].join(", "));
    this.executableOf.set(path, executable);
  }

  async buildBehindRunner(root: string, path: string): Promise<void> {
    const executable = join(this.folder, `programs-${this.flags.length}-${this.#executables++}${isWindows ? ".exe" : ""}`);
    this.builds++;
    const ran = await slot(() => spawnedFor(this.#limit, this.command(["./" + runner, fromRunner(root, path)], executable), root));
    if (ran.exitCode !== 0 || /^error\b/m.test(ran.stderr)) return void this.refused.set(path, refusedBy(ran.stderr, [path]).get(path) ?? whatABuildSaid(ran));
    this.executableOf.set(path, executable);
  }

  /**
   * The programs that the compiler refuses leave, the rest is built again, and then they among themselves. Where an error names no program the programs are built in halves. Either way down to the one.
   * So it is where the entry points have become one program: the programs that the build names for that are built alone.
   */
  async build(root: string, programs: string[]): Promise<void> {
    if (programs.length === 0) return;
    if (programs.length === 1) return this.buildAlone(programs[0]);
    const spelled = programs.map(path => fromRunner(root, path));
    if (programs.length > programsInOneExecutable || spelled.join(" ").length > longestCommandLine) return this.#buildHalves(root, programs);
    const executable = join(this.folder, `programs-${this.flags.length}-${this.#executables++}${isWindows ? ".exe" : ""}`);
    const report = executable + ".json";
    this.builds++;
    const ran = await slot(() => spawnedFor(this.#limit, this.command([`--aot-report=${report}`, "--aot-report-detail=summary", "./" + runner, ...spelled], executable), root));
    if (ran.exitCode === 0 && !/^error\b/m.test(ran.stderr)) {
      const { unseenCode, engineRuns } = this.#read(report);
      // The compiler has run once for the runner and once for each program.
      if (unseenCode.length === 0 && engineRuns === programs.length + 1) {
        for (const path of programs) this.executableOf.set(path, executable);
        if (process.env.AOT_GROUPS) appendFileSync(process.env.AOT_GROUPS, `${this.name}\t${programs.map(nameOf).join(" ")}\n`);
        return;
      }
      rmSync(executable, { force: true });
      const files = unseenCode.flatMap(({ location }) => (location ? spelledOneWay(resolve(root, location.file)) : []));
      const named = new Set(programs.filter(path => files.some(file => spelledOneWay(path) === file || (/[\\/]main\.[a-z]+$/.test(path) && file.startsWith(spelledOneWay(dirname(path) + sep))))));
      if (named.size === 0 || named.size === programs.length) return this.#buildHalves(root, programs);
      await Promise.all([this.build(root, programs.filter(path => !named.has(path))), ...[...named].map(path => this.buildAlone(path))]);
      return;
    }
    rmSync(report, { force: true });
    rmSync(executable, { force: true });
    const refused = refusedBy(ran.stderr, programs);
    const said = whatABuildSaid(ran);
    if (refused.size === 0 || refused.size === programs.length) {
      console.error(`IN HALVES: the build of ${programs.length} programs, ${this.name}, ended with ${said}`);
      const [smaller, alone] = [this.notBuiltTogether.length, this.refused.size];
      await this.#buildHalves(root, programs);
      if (smaller === this.notBuiltTogether.length && alone === this.refused.size) this.notBuiltTogether.push(`${said}\n  cd ${root} && ${this.command(["./" + runner, ...spelled], "programs").join(" ")}`);
      return;
    }
    for (const [path, error] of refused) {
      console.error(`REFUSED among ${programs.length} programs, ${this.name}: ${nameOf(path)}: ${error}`);
      if (/\binternal compiler error\b/.test(error)) this.internalErrors.push(`${nameOf(path)} among ${programs.length} programs, ${this.name}: ${error}`);
    }
    await Promise.all([this.build(root, programs.filter(path => !refused.has(path))), this.build(root, [...refused.keys()])]);
  }

  async #buildHalves(root: string, programs: string[]) {
    await Promise.all([this.build(root, programs.slice(0, programs.length >> 1)), this.build(root, programs.slice(programs.length >> 1))]);
  }
}

/**
 * Defines one test per program, of all folders: part `part` of `parts`, by a hash of the path, and of those the share of the day.
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
    const listed = process.env.AOT_PROGRAMS_LISTED ? new Set(readFileSync(process.env.AOT_PROGRAMS_LISTED, "utf8").split(/\r?\n/).map(line => line.split("\t")[0])) : undefined;
    const chosen = taken(
      find()
        // A file directly in ./programs is a helper, not a program.
        .filter(path => /[\\/]/.test(inPrograms(path)))
        .filter(path => partOf(path) === part - 1)
        .filter(mayHoldWhatIsWanted),
      path => (listed ? listed.has(nameOf(path)) : wanted === "" ? takesWhatIsDrawn && (isToldWhatToTake || isInShareOfToday(nameOf(path))) : inPrograms(path).includes(wanted)),
    ).filter(path => {
      const why = whyLeftOut(path);
      if (why && process.env.AOT_LEFT_OUT) appendFileSync(process.env.AOT_LEFT_OUT, `${nameOf(path)}\t${why.replaceAll("\n", " ")}\n`);
      return !why;
    });
    if (chosen.length === 0) return void test.skip("no program selected", () => {});
    const whatHappensToday = (path: string) => (listed ? undefined : departToday.get(nameOf(path)));

    const carrier = withoutDebugInformation();
    const ways = [new Way("compiled", [], folder, carrier), new Way("compiled with types erased", ["--aot-erase-types"], folder, carrier)];
    const typed = new Set(chosen.filter(hasTypes));
    // What is kept and what the scripts have written lie below two folders. On Windows these may be on two drives, so each is built by itself there, with the runner at its top.
    const rootInBuild = (path: string) => (isWindows ? rootOf(path) : join(import.meta.dir, "programs"));
    for (const root of new Set(chosen.map(rootInBuild))) if (!existsSync(join(root, runner))) copyFileSync(join(import.meta.dir, "programs", runner), join(root, runner));

    const isAlone = new Set(chosen.filter(path => whyAlone(path) !== undefined));
    const isTodo = (path: string) => whatHappensToday(path) !== undefined;
    // The tests are in the order of the executables.
    const ordered = [...chosen.filter(path => isAlone.has(path) && !isTodo(path)), ...chosen.filter(path => !isAlone.has(path) && !isTodo(path)), ...chosen.filter(isTodo)];
    const placeOf = new Map(ordered.map((path, place) => [path, place]));

    // A build uses one thread, so executables are built side by side, and the programs of an executable run as soon as it stands. An executable is as large as Bun: it goes when the last of
    // its programs has run, and only so many groups are built and not yet gone.
    type Group = { way: Way; programs: string[]; begin: () => void; built: Promise<void>; isBuilt: boolean; left: number; isInLine: boolean };
    const groupOf = ways.map(() => new Map<string, Group>());
    const line: Group[] = [];
    for (const [index, way] of ways.entries()) {
      const add = (programs: string[], build: () => Promise<void>, isInLine = true) => {
        const { promise, resolve } = Promise.withResolvers<void>();
        const group: Group = { way, programs, begin: resolve, built: promise.then(build), isBuilt: false, left: programs.length, isInLine };
        for (const path of programs) groupOf[index].set(path, group);
        if (isInLine) line.push(group);
      };
      for (const [root, all] of Map.groupBy(index === 0 ? ordered : ordered.filter(path => typed.has(path)), rootInBuild)) {
        for (const path of all.filter(path => isAlone.has(path) && !isTodo(path))) add([path], () => way.buildAlone(path));
        const programs = all.filter(path => !isAlone.has(path) && !isTodo(path));
        const executables = Math.ceil(programs.length / programsInOneExecutable);
        for (let first = 0, size = Math.ceil(programs.length / executables); first < programs.length; first += size) {
          const group = programs.slice(first, first + size);
          add(group, () => way.build(root, group));
        }
        // What is a todo is built by itself, when it is asked for.
        for (const path of all.filter(isTodo)) add([path], () => (isAlone.has(path) ? way.buildAlone(path) : way.buildBehindRunner(root, path)), false);
      }
    }
    line.sort((a, b) => placeOf.get(a.programs[0])! - placeOf.get(b.programs[0])!);
    let [next, standing] = [0, 0];
    function beginNext() {
      for (; standing < mostGroupsAtOnce && next < line.length; next++, standing++) {
        const group = line[next];
        group.begin();
        void group.built.finally(() => ((group.isBuilt = true), group.left === 0 && letGo(group)));
      }
    }
    function letGo(group: Group) {
      group.way.remove(group.programs);
      if (!group.isInLine) return;
      standing--;
      beginNext();
    }
    const buildFor = (index: number, path: string) => {
      const group = groupOf[index].get(path)!;
      if (group.isInLine) beginNext();
      else group.begin();
      return group.built;
    };
    /** The program has run in that way, or never will. */
    const isThrough = (index: number, path: string) => {
      const group = groupOf[index].get(path);
      if (group && --group.left === 0 && (group.isBuilt || !group.isInLine)) letGo(group);
    };
    const buildAll = () => (beginNext(), Promise.all(line.map(group => group.built)));

    type Ran = { stdout: string; stderr: string; exitCode: number; signal: number | NodeJS.Signals | null };
    const envOf = (command: string[]) => (command[0] === plainBun ? referenceEnv : bunEnv);
    let lists = 0;
    /** Starts `command`, which is the runner, for the program, in a Worker. What a Worker prints late would be taken for the next program's, so a process runs one. */
    async function runInWorker(command: string[], path: string, spelled: string, hold: typeof slot = slot): Promise<Ran> {
      const list = join(folder, `tasks-${lists++}.json`);
      writeFileSync(list, JSON.stringify([{ program: spelled, cwd: dirname(path), env: optionsOf(path).env }]));
      const ran = await hold(() => spawned(withoutCoreDump(command), dirname(path), { ...envOf(command), ...processEnvOf(path), BUN_AOT_VERBOSE: "1", AOT_TASKS: list, AOT_MARK: mark }));
      rmSync(list, { force: true });
      const parts = (text: string) => text.split(new RegExp(`\\r?\\n${mark} (-?[0-9]+)\\r?\\n`));
      const [stdout, stderr] = [parts(ran.stdout), parts(ran.stderr)];
      if (Math.min(stdout.length, stderr.length) > 1) return { stdout: stdout[0], stderr: stderr[0], exitCode: Number(stdout[1]), signal: null };
      return { stdout: stdout[0], stderr: stderr[0], exitCode: ran.exitCode, signal: ran.signal };
    }
    // See measuresTimeOrMemory().
    const whileNothingElseRuns: typeof slot = work => withEverySlot(0, work);
    const runOnMainThread = (command: string[], path: string, hold: typeof slot = slot): Promise<Ran> =>
      hold(() => spawned(withoutCoreDump(command), dirname(path), { ...envOf(command), ...optionsOf(path).env, BUN_AOT_VERBOSE: "1" }));
    const runPlain = (path: string, inWorker: boolean, hold?: typeof slot) =>
      inWorker ? runInWorker([plainBun, "run", join(import.meta.dir, "programs", runner)], path, path, hold) : runOnMainThread([plainBun, "run", path], path, hold);
    const runCompiled = (way: Way, path: string, hold?: typeof slot) =>
      way.alone.has(path) ? runOnMainThread([way.executableOf.get(path)!], path, hold) : runInWorker([way.executableOf.get(path)!], path, fromRunner(rootInBuild(path), path), hold);

    let explained = 0;
    const says = (path: string, way: Way, what: string) => {
      if (process.env.AOT_REDS) appendFileSync(process.env.AOT_REDS, `${nameOf(path)}\t${way.name}\t${what.replaceAll("\n", " | ").slice(0, 300)}\n`);
      const topic = nameOf(path).split("/")[0];
      const file = existsSync(join(import.meta.dir, `${topic}.test.ts`)) ? `test/aot/${topic}.test.ts` : `test/aot/parts.test.ts`;
      console.error(`RED: ${nameOf(path)}, ${way.name}, one of ${way.executableOf.size} entry points: ${what}\n  alone: AOT_PROGRAMS=${nameOf(path)} TEST_PART=aot/${topic} bun test ${file}`);
    };
    /** Does the program do the same when it is the only one in its executable? */
    async function explain(path: string, way: Way, judge: (result: RunResult) => void) {
      if (way.alone.has(path) || explained++ >= redsExplained) return;
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

    for (const path of ordered) {
      const known = whatHappensToday(path);
      (known === undefined ? test : test.todo)(
        known === undefined ? nameOf(path) : `${nameOf(path)} (${known})`,
        async () => {
          const options = optionsOf(path);
          const comparesTimes = measuresTimeOrMemory(path);
          // A Worker is held to a Worker of plain Bun.
          const references = new Map<boolean, RunResult>();
          let through = 0;
          using _ = { [Symbol.dispose]: () => void ways.forEach((_, index) => index >= through && isThrough(index, path)) };
          for (const [index, way] of ways.entries()) {
            using _ = { [Symbol.dispose]: () => (isThrough(index, path), void (through = index + 1)) };
            if (index === 1 && !typed.has(path)) continue;
            const stored = index === 1 && options.erased ? "" : besideOf(path) + ".expected.txt";
            await buildFor(index, path);
            const inWorker = !way.alone.has(path);
            if (!existsSync(stored) && !references.has(inWorker)) {
              const plain = await runPlain(path, inWorker, comparesTimes ? whileNothingElseRuns : slot);
              const hasFailed = plain.signal !== null || plain.exitCode !== 0;
              expect({ signal: plain.signal, exitCode: plain.exitCode, stderr: hasFailed ? plain.stderr : "" }).toEqual({ signal: null, exitCode: 0, stderr: "" });
              references.set(inWorker, told(plain));
            }
            const judge = (result: RunResult) => (existsSync(stored) ? expectStored(stored, result) : expect({ way: way.name, ...result }).toEqual({ way: way.name, ...references.get(inWorker)! }));
            let happened = "it did not start";
            try {
              expect({ way: way.name, refused: way.refused.get(path) }).toEqual({ way: way.name, refused: undefined });
              for (let attemptsLeft = comparesTimes ? 3 : 0; ; attemptsLeft--) {
                const ran = await runCompiled(way, path, comparesTimes ? whileNothingElseRuns : slot);
                const result = told({ ...ran, stderr: ran.stderr.replace(/^\[aot\] .*\r?\n/gm, "") });
                happened = ran.signal !== null ? String(ran.signal) : firstDifference(result, existsSync(stored) ? readFileSync(stored, "utf8") : references.get(inWorker)!);
                expect({ way: way.name, signal: ran.signal, stderr: ran.signal ? ran.stderr : "" }).toEqual({ way: way.name, signal: null, stderr: "" });
                // The executable really ran compiled code and did not fall back to the embedded source.
                expect(ran.stderr).toContain("[aot] module: ");
                try {
                  judge(result);
                  break;
                } catch (error) {
                  if (attemptsLeft === 0) throw error;
                  console.error(`ASKED AGAIN: ${nameOf(path)}, ${way.name}: ${happened}`);
                  if (!existsSync(stored)) references.set(inWorker, told(await runPlain(path, inWorker, whileNothingElseRuns)));
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

    // Entry points that are built one by one and not together are a valid program that the compiler refuses.
    test(
      "the programs are built together",
      async () => {
        await buildAll();
        expect(ways.flatMap(way => way.notBuiltTogether)).toEqual([]);
        for (const way of ways) {
          console.error(`WORLD: ${way.name}: ${way.executableOf.size - way.alone.size} programs are a program each; ${way.alone.size} are built alone, of which ${isAlone.size} for how they are written, and ${way.opens.size} may run code that the build has not seen; ${way.builds} builds`);
          if (process.env.AOT_OPENS) for (const [path, reason] of way.opens) appendFileSync(process.env.AOT_OPENS, `${nameOf(path)}\t${way.name}\t${reason}\n`);
        }
      },
      1_500_000,
    );

    test(
      "the compiler reports no internal error",
      async () => {
        await buildAll();
        expect(ways.flatMap(way => way.internalErrors)).toEqual([]);
      },
      1_500_000,
    );
  });
}
