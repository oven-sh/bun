// Programs that are written by a generator and not kept as files. Each is built with `bun build --compile --aot`, and what the executable
// prints is compared, line by line, with what plain `bun run` prints for the same text. So is what `bun run --aot` prints, which runs the
// sources under the rules of --aot without compiling them: it and the executable must agree, also where both depart from plain Bun.
//
//   bun test test/aot/generated-operands                     a quarter of the part of each generator's programs that is meant for every run, another for each commit (`inShare` in ../run-programs.ts),
//                                                            every program that once showed a fault, and one in four hundred of the rest, others for each commit
//   AOT_SHARE=all bun test test/aot/generated-operands       that part whole
//   AOT_GENERATED=all bun test test/aot/generated-operands   all of them
//   AOT_GENERATED=<text> bun test test/aot/generated-..      those whose name contains the text
//   AOT_GENERATED_KEEP=<folder> bun test ..                  writes the programs there and leaves them
//   AOT_GENERATED_FLAGS="--aot-threads=1" bun test ..        more flags for every build
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { built, inShare, inShareOfList, inShareOfTheRest, wanted as programsWanted, slot, takesWhatIsFixed, spawned, unsupported, withoutCoreDump, withoutCrashReport } from "../run-programs";

export type Generated = {
  name: string;
  isAlwaysRun: boolean;
  /** It once showed a fault. It is meant for every run, and no run leaves it to another commit. */
  wasOnceWrong?: boolean;
  make: () => { file: string; text: string; files?: Record<string, string> };
  /** The program tries what --aot does not allow. It may fail to build, or catch a TypeError and print "THROWS TypeError". It may not print anything else that plain Bun does not. */
  mayBeRefused?: true;
  /**
   * Its lines are `<group> | <line>`. A group that tries what is not allowed may end early, with a line that says REFUSED or THROWS: what stands ahead of that
   * line is the same in the executable and in plain Bun. The groups that match the expression print what differs from run to run and are not compared.
   * `bun run --aot` is left out: such a program prints what depends on whether it runs from its sources or as an executable.
   */
  groupsMayBeRefused?: RegExp;
  /** One of very many programs about what the compiler proves. `bun run --aot` is left out: it takes as long as the build. */
  isOnlyCompiled?: true;
  /** It leaves an error that nobody catches: plain Bun goes on and exits with 1, and so does the executable. */
  leavesAnError?: true;
  /** It ends in one of many ways. The executable ends with the exit code that plain Bun ends with. */
  exitsAsPlainBunDoes?: true;
  /** Under `alsoUnder` it runs out of room for objects. Where no error can be thrown there, the executable stops with "FATAL: out of memory", which is meant. */
  mayStopOutOfMemory?: true;
  /** Nobody has looked at the program. Where TypeScript rejects it, or plain Bun fails on it or needs too long, there is nothing to compare. A crash of the build still fails the test. */
  mayBeUnjudgeable?: true;
  /** Set where plain Bun runs the program for reference, and nowhere else. */
  plainEnv?: Record<string, string>;
  /** Lines whose answer is written down in the test and not asked of plain Bun: a line that starts with a key ends with its value. */
  written?: Record<string, string>;
  /** More flags for the build of this program. */
  flags?: string[];
  /** The executable runs once more under each of these and prints the same. */
  alsoUnder?: Record<string, string>[];
  /** How the program departs from plain Bun today. It is listed as a todo and not run. */
  failsToday?: string;
  /** How its lines depart from those of plain Bun today. It is built and run all the same, and ends by itself. */
  linesDepartToday?: string;
  /** How `bun run --aot` departs from the executable today. That run is listed as a todo and left out. The executable is compared with plain Bun all the same. */
  modeFailsToday?: string;
};

const wanted = process.env.AOT_GENERATED ?? "";
export const moreFlags = process.env.AOT_GENERATED_FLAGS?.split(" ").filter(flag => flag) ?? [];

function departingGroups(ours: string[], theirs: string[], notCompared: RegExp) {
  const groups = (lines: string[]) => Map.groupBy(lines.filter(line => line.includes(" | ")), line => line.slice(0, line.indexOf(" | ")));
  const mine = groups(ours);
  const departing: string[] = [];
  for (const [group, lines] of groups(theirs)) {
    if (notCompared.test(group)) continue;
    const got = mine.get(group) ?? [];
    const at = lines.findIndex((line, i) => got[i] !== line);
    if (at < 0 ? got.length === lines.length : /REFUSED|THROWS/.test((got[at]?.slice(group.length) ?? "") + lines[at].slice(group.length))) continue;
    departing.push(`--aot: ${got.join("\n")}\nplain: ${lines.join("\n")}`);
  }
  return departing.slice(0, 20);
}

export function generated(title: string, programs: Generated[]) {
  const kept = process.env.AOT_GENERATED_KEEP;
  const root = kept ?? String(tempDir("aot-generated", {}));
  if (!kept) afterAll(() => rmSync(root, { recursive: true, force: true }));
  const isMeantForEveryRun = (program: Generated) => program.isAlwaysRun || !!program.wasOnceWrong;
  const chosen = programs
    .filter(program => (wanted === "all" ? true : wanted ? program.name.includes(wanted) : isMeantForEveryRun(program) || inShareOfTheRest(`${title} ${program.name}`, 400)))
    // A debug or ASAN build of Bun is many times slower.
    .filter((program, index) => wanted || programsWanted !== "quick" || !isMeantForEveryRun(program) || inShareOfList(`${title} ${program.name}`, index))
    .filter(program => wanted || (program.wasOnceWrong && takesWhatIsFixed) || !isMeantForEveryRun(program) || inShare(`${title} ${program.name}`, 4));

  describe.concurrent(`compile/aot/generated/${title}`, () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    if (chosen.length === 0) test.skip("no program selected", () => {});
    chosen.forEach((program, index) => {
      if (program.failsToday) return void test.todo(program.name);
      if (program.modeFailsToday) test.todo(`${program.name}, by bun run --aot`);
      test(
        program.name,
        () =>
          slot(async () => {
            const folder = join(root, title.replaceAll(" ", "-"), String(index));
            const { file, text, files } = program.make();
            for (const [name, content] of Object.entries({ ...files, [file]: text })) {
              mkdirSync(dirname(join(folder, name)), { recursive: true });
              writeFileSync(join(folder, name), content);
            }
            const executable = join(folder, isWindows ? "program.exe" : "program");
            try {
              if (program.mayBeUnjudgeable && (await spawned([bunExe(), "run", file], folder, { ...bunEnv, ...program.plainEnv })).exitCode !== 0) return;
              const build = await spawned([bunExe(), "build", "--compile", "--aot", ...moreFlags, ...(program.flags ?? []), file, "--outfile", executable], folder, bunEnv);
              if (program.mayBeUnjudgeable && build.exitCode === 1 && /^error: TS\d+:/m.test(build.stderr)) return;
              const fromSources = program.modeFailsToday || program.groupsMayBeRefused || program.isOnlyCompiled ? undefined : await spawned([bunExe(), "run", "--aot", file], folder, bunEnv);
              if (program.mayBeRefused && build.exitCode === 1 && /^error\b/m.test(build.stderr)) return void (fromSources && expect(fromSources.exitCode).not.toBe(0));
              built(build);
              const compiled = await spawned([executable], folder, { ...bunEnv, BUN_AOT_VERBOSE: "1" });
              if (fromSources) expect({ stdout: fromSources.stdout, signal: fromSources.signal, exitCode: fromSources.exitCode }).toEqual({ stdout: compiled.stdout, signal: compiled.signal, exitCode: compiled.exitCode });
              const plain = await spawned([bunExe(), "run", file], folder, { ...bunEnv, ...program.plainEnv });
              const exitCode = program.exitsAsPlainBunDoes ? plain.exitCode : program.leavesAnError ? 1 : 0;
              expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode });
              expect(compiled.stderr).toContain("[aot] module: ");
              if (program.linesDepartToday) return void expect(compiled.signal).toBeNull();
              if (program.mayBeRefused && compiled.exitCode === 0 && compiled.stdout.startsWith("THROWS TypeError ")) return;
              const written = Object.entries(program.written ?? {});
              const [ours, theirs] = [compiled.stdout.split("\n"), plain.stdout.split("\n").map(line => written.find(([start]) => line.startsWith(start))?.join("") ?? line)];
              if (program.groupsMayBeRefused) return void expect({ departing: departingGroups(ours, theirs, program.groupsMayBeRefused), signal: compiled.signal, exitCode: compiled.exitCode }).toEqual({ departing: [], signal: null, exitCode: 0 });
              const departing: string[] = [];
              for (let i = 0; i < Math.max(ours.length, theirs.length) && departing.length < 20; i++) {
                if (ours[i] !== theirs[i]) departing.push(`--aot: ${ours[i]}\nplain: ${theirs[i]}`);
              }
              expect({ departing, signal: compiled.signal, exitCode: compiled.exitCode, lines: ours.length }).toEqual({ departing: [], signal: null, exitCode, lines: theirs.length });
              for (const under of program.alsoUnder ?? []) {
                const again = await spawned(program.mayStopOutOfMemory ? withoutCoreDump([executable]) : [executable], folder, { ...bunEnv, ...(program.mayStopOutOfMemory && withoutCrashReport), ...under });
                if (program.mayStopOutOfMemory && again.stderr.includes("FATAL: out of memory")) continue;
                expect({ under, stdout: again.stdout, signal: again.signal, exitCode: again.exitCode }).toEqual({ under, stdout: plain.stdout, signal: null, exitCode });
              }
            } finally {
              rmSync(executable, { force: true });
            }
          }),
        600_000,
      );
    });
  });
}
