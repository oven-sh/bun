// Every program under ./programs, in every run. A build costs half a second of processor time before it has read a line of the program, and a program of twenty lines is built twice: built
// one by one, all programs are too much for a commit, so run-programs.ts takes one in ten. Here the programs of a part are the entry points of ONE executable, behind
// programs/start-the-entry-point-named.ts, which imports the one that AOT_PROGRAM names. One build for hundreds of programs, and each of them still runs in a process of its own:
// it may exit, change a built-in or read the clock. Each is judged as run-programs.ts judges it: with its types and with its types erased it prints what plain Bun prints, or its .expected.txt.
//
// The compiler sees the whole program, so a program among hundreds is not compiled as it is alone: what one of them does to a class or a built-in holds for all. This is beside the share of
// run-programs.ts and programs-in-every-run.txt, which build each program alone, and not in their place.
//
// Left out: a program that is built with flags, entry points or an environment of its own; one whose build is meant to fail; one below a tsconfig.json of its own, because the first entry
// point's governs a build; one that declares types for everybody (`declare global`, a declaration file); and one with "alone" in its <program>.json: what it prints hangs on being the
// first entry point (import.meta.main, require.main, module.id, process.argv[1]) or on what else the executable holds.
//
//   TEST_PART=aot/every-program-3 bun test test/aot/parts.test.ts      one part
//   AOT_PROGRAMS=<text> TEST_PART=aot/every-program bun test ..        the programs whose path contains the text, alone among themselves
//   AOT_PROGRAMS_LISTED=<file> ..                                      the programs that the file lists, one a line, as paths below ./programs without the extension
//   AOT_BUILD_FLAGS="--aot-validate" ..                                every build takes these flags too
//   AOT_REDS=<file> ..                                                 gets a line for each program that is red: <name>, a tab, the way, a tab, what happened
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { dirname, join, normalize, relative, sep } from "path";
import {
  besideOf,
  expectStored,
  find,
  hasTypes,
  inPrograms,
  inShare,
  mayHoldWhatIsWanted,
  slot,
  spawned,
  taken,
  told,
  unsupported,
  wanted,
  withoutCoreDump,
  withoutDebugInformation,
  type RunResult,
} from "./run-programs";

const starter = "start-the-entry-point-named.ts";
// Windows takes 32,767 characters.
const longestCommandLine = isWindows ? 30_000 : 1_000_000;
const redsExplained = 5;
// The two builds of a part run at once, and the smallest machines that run them have 8 GB.
const mostMegabytesOfABuild = 3200;

type Options = { build?: string[]; entryPoints?: string[]; buildEnv?: object; env?: Record<string, string>; reference?: string; erased?: string; alone?: string; skipWithASAN?: string; todoOn?: Record<string, string> };
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
  // require.main is the module of the first entry point.
  /^ways-into-library-modules\/.*-through-require-main-require-in-commonjs$/,
];

function canBeOneOfMany(path: string): boolean {
  const beside = besideOf(path);
  if (familiesAlone.some(family => family.test(nameOf(path)))) return false;
  if (existsSync(beside + ".todo.txt") || existsSync(beside + ".build-errors.txt")) return false;
  const { build, entryPoints, buildEnv, reference, alone, skipWithASAN, todoOn } = optionsOf(path);
  if (build?.length || entryPoints?.length || buildEnv || reference || alone || (isASAN && skipWithASAN) || todoOn?.[process.platform]) return false;
  return !hasProjectOfItsOwn(path) && !declaresForEverybody(path);
}

async function spawnedFor(seconds: number, cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: seconds * 1000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode, megabytes: Math.round((proc.resourceUsage()?.maxRSS ?? 0) / 1e6) };
}

/** As an entry point is spelled for a build in `root`, and for the starter there. */
const fromStarter = (root: string, path: string) => "./" + relative(root, path).replaceAll("\\", "/");

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
  /** The most memory that one of its builds had resident. */
  mostMegabytes = 0;
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
    const spelled = programs.map(path => fromStarter(root, path));
    if (programs.length > 1 && spelled.join(" ").length > longestCommandLine) return this.#buildHalves(root, programs);
    const executable = join(this.folder, `programs-${this.flags.length}-${this.#executables++}${isWindows ? ".exe" : ""}`);
    const ran = await spawnedFor(isASAN || isDebug || process.env.AOT_BUILD_FLAGS ? 1200 : 280, this.command(["./" + starter, ...spelled], executable), root);
    this.mostMegabytes = Math.max(this.mostMegabytes, ran.megabytes);
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
      if (smaller === this.notBuiltTogether.length && alone === this.refused.size) this.notBuiltTogether.push(`${said}\n  cd ${root} && ${this.command(["./" + starter, ...spelled], "programs").join(" ")}`);
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
 * Defines one test per program, of all folders: part `part` of `parts`, by a hash of the path. A debug or ASAN build of Bun takes a tenth of them, another for each commit.
 */
export function programsAsEntryPoints(part = 1, parts = 1) {
  const folder = String(tempDir("aot-entry-points", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  describe.concurrent("compile/aot/every-program", () => {
    if (unsupported) return void test.skip(unsupported, () => {});
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
      path => (listed ? listed.has(nameOf(path)) : wanted === "quick" ? inShare(inPrograms(path), 10, true) : inPrograms(path).includes(wanted)),
    ).filter(canBeOneOfMany);
    if (chosen.length === 0) return void test.skip("no program selected", () => {});

    const carrier = withoutDebugInformation();
    const ways = [new Way("compiled", [], folder, carrier), new Way("compiled with types erased", ["--aot-erase-types"], folder, carrier)];
    const typed = new Set(chosen.filter(hasTypes));
    // What is kept and what the scripts have written lie below two folders. On Windows these may be on two drives, so each is built by itself there, with the starter at its top.
    const byRoot = isWindows ? Map.groupBy(chosen, rootOf) : new Map([[join(import.meta.dir, "programs"), chosen]]);
    const rootInBuild = (path: string) => (isWindows ? rootOf(path) : join(import.meta.dir, "programs"));
    for (const root of byRoot.keys()) if (!existsSync(join(root, starter))) copyFileSync(join(import.meta.dir, "programs", starter), join(root, starter));
    let built: Promise<void>[] | undefined;
    const buildOnce = (index: number) =>
      (built ??= ways.map(async (way, index) => {
        for (const [root, programs] of byRoot) await way.build(root, index === 0 ? programs : programs.filter(path => typed.has(path)));
      }))[index];

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
        console.error(`MEMORY: ${ways.map(way => `${way.name}: ${way.mostMegabytes} MB`).join(", ")}`);
        if (isLinux && !isASAN && !isDebug && !process.env.AOT_BUILD_FLAGS) expect(Math.max(...ways.map(way => way.mostMegabytes))).toBeLessThan(mostMegabytesOfABuild);
      },
      1_500_000,
    );

    for (const path of chosen) {
      test(
        nameOf(path),
        async () => {
          const options = optionsOf(path);
          const cwd = dirname(path);
          let reference: RunResult | undefined;
          for (const [index, way] of ways.entries()) {
            if (index === 1 && !typed.has(path)) continue;
            const stored = index === 1 && options.erased ? "" : besideOf(path) + ".expected.txt";
            if (!existsSync(stored) && !reference) {
              const plain = await slot(() => spawned([bunExe(), "run", path], cwd, { ...bunEnv, ...options.env }));
              const hasFailed = plain.signal !== null || plain.exitCode !== 0;
              expect({ signal: plain.signal, exitCode: plain.exitCode, stderr: hasFailed ? plain.stderr : "" }).toEqual({ signal: null, exitCode: 0, stderr: "" });
              reference = told(plain);
            }
            const judge = (result: RunResult) => (existsSync(stored) ? expectStored(stored, result) : expect({ way: way.name, ...result }).toEqual({ way: way.name, ...reference! }));
            await buildOnce(index);
            let happened = "it did not start";
            try {
              expect({ way: way.name, refused: way.refused.get(path) }).toEqual({ way: way.name, refused: undefined });
              const ran = await slot(() => spawned(withoutCoreDump([way.executableOf.get(path)!]), cwd, { ...bunEnv, ...options.env, BUN_AOT_VERBOSE: "1", AOT_PROGRAM: fromStarter(rootInBuild(path), path) }));
              const result = told({ ...ran, stderr: ran.stderr.replace(/^\[aot\] .*\r?\n/gm, "") });
              happened = ran.signal ?? firstDifference(result, existsSync(stored) ? readFileSync(stored, "utf8") : reference!);
              expect({ way: way.name, signal: ran.signal, stderr: ran.signal ? ran.stderr : "" }).toEqual({ way: way.name, signal: null, stderr: "" });
              // The executable really ran compiled code and did not fall back to the embedded source.
              expect(ran.stderr).toContain("[aot] module: ");
              judge(result);
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
