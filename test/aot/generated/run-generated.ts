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
//   AOT_GENERATED_COLLECTS=all bun test ..                   every program collects inside its calls (../fuzz/collections-inside-calls.ts), not only those that are drawn for it
//   AOT_GENERATED_HANDS=all bun test ..                      every program hands its functions to the host (../fuzz/functions-the-host-could-call.ts)
//   AOT_GENERATED_INSIDE=all bun test ..                     the text of every program stands inside something (../fuzz/the-whole-file-inside-something.ts)
//   AOT_GENERATED_OPENS=all bun test ..                      every program opens the world (../fuzz/the-world-is-open.ts)
//   AOT_GENERATED_READS_LESS=all bun test ..                 every program takes the name and the message of what it has caught out of `${caught}` (the form `caught` of ../tools/let-values-be-something-else.ts)
//   AOT_GENERATED_LAUNDERS=all bun test ..                   what every program works on has come back from text that nobody knows (../fuzz/what-a-program-works-on-comes-back-from-text-nobody-knows.ts)
//   AOT_GENERATED_IN_ONE_EXECUTABLE=1 bun test ..            an executable for each program, also where programs share one
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { dirname, join, sep } from "path";
import { withCollectionsInsideCalls } from "../fuzz/collections-inside-calls";
import { withFunctionsTheHostCouldCall } from "../fuzz/functions-the-host-could-call";
import { Random } from "../fuzz/random";
import { places, withTheWholeFileInside } from "../fuzz/the-whole-file-inside-something";
import { opensTheWorld, withTheWorldOpen } from "../fuzz/the-world-is-open";
import { withTurnsNobodyKnows } from "../fuzz/turns-nobody-knows";
import { built, slot, spawned, unsupported, withEverySlot, withoutCoreDump, withoutCrashReport } from "../harness/commands";
import { inShare, inShareOfList, inShareOfTheRest, isToldWhatToTake, wanted as programsWanted, takeFromShare, takesWhatIsFixed } from "../harness/shares";
import onceWrong from "./once-wrong.json";

export type Generated = {
  name: string;
  isAlwaysRun: boolean;
  /** It once showed a fault. It is meant for every run, and no run leaves it to another commit. once-wrong.json marks programs by title and name too. */
  wasOnceWrong?: boolean;
  /** `file` is what runs. `entryPoints` are files that the build is given behind it. `links`: where a link lies, and what it points to, as seen from the folder that it lies in. */
  make: () => {
    file: string;
    text: string;
    files?: Record<string, string>;
    links?: Record<string, string>;
    entryPoints?: string[];
  };
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
  /** It starts its executable again, with arguments of its own, so it shares its executable with no other program. */
  startsItself?: true;
  /** What it prints hangs on what else its executable holds, so it shares its executable with no other program. */
  isBuiltAlone?: true;
  /** What it prints hangs on when a collection runs, so it takes no collections inside its calls. */
  hangsOnCollections?: true;
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
  /** The reference is an executable that is built without --aot, not `bun run`: the two answer the program differently, and docs/compiler/compatibility.mdx says which one --aot follows. */
  referenceIsCompiled?: true;
  /** Lines whose answer is written down in the test and not asked of plain Bun: a line that starts with a key ends with its value. */
  written?: Record<string, string>;
  /** The lines that the executable prints. Plain Bun prints the same lines in another order, and docs/compiler/compatibility.mdx says where. */
  printsInThisOrder?: string[];
  /** Nothing is put into its text: it declares names such as `Bun`, `Symbol` and `globalThis` itself, and what a run puts into a text uses them. */
  keepsItsText?: true;
  /** More flags for the build of this program. */
  flags?: string[];
  /** Flags of `bun build` that decide what the program is, such as --feature and --define. The reference is built with them too, so it is compiled. */
  flagsOfBothBuilds?: string[];
  /** What it prints differs in a build with --aot-validate, or it runs past its time limit there. */
  isNeverValidated?: true;
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
  const groups = (lines: string[]) =>
    Map.groupBy(
      lines.filter(line => line.includes(" | ")),
      line => line.slice(0, line.indexOf(" | ")),
    );
  const mine = groups(ours);
  const departing: string[] = [];
  for (const [group, lines] of groups(theirs)) {
    if (notCompared.test(group)) continue;
    const got = mine.get(group) ?? [];
    const at = lines.findIndex((line, i) => got[i] !== line);
    if (
      at < 0
        ? got.length === lines.length
        : /REFUSED|THROWS/.test((got[at]?.slice(group.length) ?? "") + lines[at].slice(group.length))
    )
      continue;
    departing.push(`--aot: ${got.join("\n")}\nplain: ${lines.join("\n")}`);
  }
  return departing.slice(0, 20);
}

function stderrOfFailure(run: { stderr: string; signal: unknown; exitCode: number | null }, exitCode: number) {
  return run.exitCode === exitCode && run.signal === null ? {} : { stderr: run.stderr.slice(-4000) };
}

// A build writes an executable the size of Bun however small the program is, and a system may look at a new executable before it starts it for the first time. So the programs that are
// only compiled share executables. Each is an entry point behind ../fixtures/run-each-in-a-worker.ts: an entry point begins a program of its own, so the compiler makes of it what it makes
// of it alone, unless one of them opens the world (../fuzz/the-world-is-open.ts): then all are one program. So the programs that open it share executables among themselves. A program
// runs in a Worker, a global of its own, in a process of its own, and so it does in plain Bun. What is not built together with the others is built alone, and so is
// what once went wrong, wherever a run takes all of that. A debug or ASAN build of Bun takes too few programs to share anything.
const programsInOneExecutable = Number(process.env.AOT_GENERATED_IN_ONE_EXECUTABLE) || 32;
// A build of large programs is mostly their own work, and several small builds use the cores better than one large build.
const bytesInOneExecutable = 64 * 1024;
// What starts a Worker holds more of the library: its build costs as much as those of four small programs.
const fewestInOneExecutable = 6;
const executablesAtOnce = 8;
// The build of a program this large takes from half a gigabyte to two, so nothing else that takes a slot runs beside it.
const bytesOfALargeProgram = 640 * 1024;
const slotFor = (program: Generated): typeof slot =>
  program.make().text.length < bytesOfALargeProgram ? slot : work => withEverySlot(0, work);
const runner = "run-each-in-a-worker.ts";
const mark = "=== the program above has ended with";
const sharesAnExecutable = (program: Generated) =>
  programsInOneExecutable > 1 &&
  !isASAN &&
  !isDebug &&
  !!program.isOnlyCompiled &&
  !program.startsItself &&
  !program.isBuiltAlone &&
  !(program.wasOnceWrong && takesWhatIsFixed) &&
  !program.mayBeRefused &&
  !program.groupsMayBeRefused &&
  !program.leavesAnError &&
  !program.exitsAsPlainBunDoes &&
  !program.mayStopOutOfMemory &&
  !program.plainEnv &&
  !program.referenceIsCompiled &&
  !program.written &&
  !program.linesDepartToday;

type Run = Awaited<ReturnType<typeof spawned>>;
/** What became of a program that shares an executable: its runs, `again` under each of `alsoUnder`, or why there are none. */
type Shared =
  | { entry: string; plain: Run; compiled: Run; again: Run[]; beside: number }
  | "left out"
  | "nothing to compare"
  | "alone";

/** What the one program of the process printed in its Worker, and the exit code of the Worker. A process that ended early has printed no mark and is answered as it is. */
function inItsWorker(run: Run): Run {
  const parts = (text: string) => text.split(new RegExp(`\\r?\\n${mark} (-?[0-9]+)\\r?\\n`));
  const [stdout, exitCode] = parts(run.stdout);
  return exitCode === undefined || run.exitCode !== 0 || run.signal !== null
    ? run
    : { ...run, stdout, stderr: parts(run.stderr)[0], exitCode: Number(exitCode) };
}

export function generated(title: string, given: Generated[]) {
  const listed = (onceWrong as Record<string, string[]>)[title] ?? [];
  const programs = given.map(program => (listed.includes(program.name) ? { ...program, wasOnceWrong: true } : program));
  const unknown = listed.filter(name => !given.some(program => program.name === name));
  if (unknown.length) test(`once-wrong.json names programs of "${title}"`, () => expect(unknown).toEqual([]));
  const kept = process.env.AOT_GENERATED_KEEP;
  const root = kept ?? String(tempDir("aot-generated", {}));
  if (!kept) afterAll(() => rmSync(root, { recursive: true, force: true }));
  const isMeantForEveryRun = (program: Generated) => program.isAlwaysRun || !!program.wasOnceWrong;
  const chosen = programs
    .filter(program =>
      wanted === "all"
        ? true
        : wanted
          ? program.name.includes(wanted)
          : isMeantForEveryRun(program) || inShareOfTheRest(`${title} ${program.name}`, 400),
    )
    // A debug or ASAN build of Bun is many times slower.
    .filter(
      (program, index) =>
        wanted ||
        programsWanted !== "quick" ||
        !isMeantForEveryRun(program) ||
        inShareOfList(`${title} ${program.name}`, index),
    )
    .filter(
      program =>
        wanted ||
        (program.wasOnceWrong && takesWhatIsFixed) ||
        !isMeantForEveryRun(program) ||
        inShare(`${title} ${program.name}`, 4),
    );
  // A share that comes out empty takes one program.
  if (chosen.length === 0 && !wanted)
    chosen.push(
      ...takeFromShare(
        programs.some(isMeantForEveryRun) ? programs.filter(isMeantForEveryRun) : programs,
        1,
        program => `${title} ${program.name}`,
      ),
    );
  // The runner of CI ends a file after five minutes, and a machine that runs several jobs at once builds these programs at a quarter of its usual rate. What a run draws is a share
  // that goes by the commit, so a file that has run for 200 seconds starts no more of it and says so. What a run is told to take is run whole, and so is what once went wrong.
  const mayBeLeftOut = (program: Generated) =>
    !wanted && !isToldWhatToTake && !(program.wasOnceWrong && takesWhatIsFixed);
  let leftOut = 0;
  let executables = 0;
  const shares = { "a program each": 0, "one program": 0 };
  afterAll(() => {
    if (leftOut)
      console.error(
        `SHARE: ${leftOut} of the ${chosen.length} programs that this run drew were not run: the file had run for 200 seconds`,
      );
    if (executables) console.error(`BUILT: ${executables} executables for ${chosen.length} programs`);
    if (shares["a program each"] + shares["one program"])
      console.error(
        `SHARED: ${shares["a program each"]} programs are a program each in their executables, ${shares["one program"]} are one program with the others`,
      );
  });

  // A program that is here for what it once showed stays as it is.
  const staysAsItIs = (program: Generated) =>
    !!program.wasOnceWrong || !!program.linesDepartToday || !!program.written || !!program.keepsItsText;
  // A change to a text can hide what the text shows, so half the programs of a family run as they are written. Of the other half, two in three take one change, and each of the rest takes
  // every change that a draw of its own gives it. Each of these changes brings something that the build does not know. One takes something away, and a quarter of the first half takes it alone:
  // a member that is read off what a `catch` has caught is a read off a value that nobody knows, and with it a build holds every getter of that name. Without it the program may be all there is.
  const changes = ["turns", "collections", "host", "inside", "open"] as const;
  const isDrawn = (program: Generated, change: (typeof changes)[number], byItself: boolean) => {
    const draw = Bun.hash.crc32(`${title} | ${program.name}`);
    if (draw % 2 === 0) return false;
    return (draw >>> 1) % 3 === 0 ? byItself : changes[(draw >>> 3) % changes.length] === change;
  };
  // A flag holds for a whole build, and so does an open world. Where a draw would leave too few programs on either side to fill an executable, the programs that could share one stay
  // together: the draw of the first that may be drawn holds for all that may, or for none.
  function drawnAmong(
    alike: Generated[],
    mayBeDrawn: (program: Generated) => boolean,
    isTaken: (program: Generated) => boolean,
  ) {
    const fills = (count: number) => count === 0 || count >= fewestInOneExecutable;
    const all = alike.filter(mayBeDrawn);
    const drawn = all.filter(isTaken);
    if (alike.length < fewestInOneExecutable || (fills(drawn.length) && fills(alike.length - drawn.length)))
      return drawn;
    return all.length && isTaken(all[0]) && fills(all.length) && fills(alike.length - all.length) ? all : [];
  }
  const couldShare = (program: Generated) => !program.failsToday && sharesAnExecutable(program);
  const flagsOf = (program: Generated) => (program.flags ?? []).join(" ");
  const isOpenAsWritten = (program: Generated) => opensTheWorld(program.make().text);
  const isDrawnByItselfToOpenTheWorld = (program: Generated) =>
    isDrawn(program, "open", Bun.hash.crc32(`${program.name} : ${title}`) % 6 === 0);
  const opened = new Set(
    process.env.AOT_GENERATED_OPENS === "all"
      ? chosen.filter(program => !staysAsItIs(program))
      : [
          ...chosen.filter(
            program =>
              (!couldShare(program) || isOpenAsWritten(program)) &&
              !staysAsItIs(program) &&
              isDrawnByItselfToOpenTheWorld(program),
          ),
          ...Map.groupBy(
            chosen.filter(program => couldShare(program) && !isOpenAsWritten(program)),
            flagsOf,
          )
            .values()
            .flatMap(alike => drawnAmong(alike, program => !staysAsItIs(program), isDrawnByItselfToOpenTheWorld)),
        ],
  );
  // One program in four that takes no flags of its own is built with --aot-validate: its executable checks while it runs what the compiler took for granted, and stops where that does not hold,
  // also where the program would have printed the right lines all the same.
  const mayBeValidated = (program: Generated) =>
    !program.flags?.length &&
    !program.isNeverValidated &&
    !program.mayStopOutOfMemory &&
    !program.failsToday &&
    !program.linesDepartToday &&
    !moreFlags.length &&
    // A very large program takes many times as long that way.
    !/\bvery (many|large|long)\b/.test(title) &&
    program.make().text.length < 32 * 1024;
  const isDrawnByItselfToValidate = (program: Generated) => Bun.hash.crc32(`${title} ? ${program.name}`) % 4 === 0;
  const validated = new Set([
    ...chosen.filter(program => !couldShare(program) && mayBeValidated(program) && isDrawnByItselfToValidate(program)),
    ...Map.groupBy(
      chosen.filter(program => couldShare(program) && !program.flags?.length),
      program => opened.has(program) || isOpenAsWritten(program),
    )
      .values()
      .flatMap(alike => drawnAmong(alike, mayBeValidated, isDrawnByItselfToValidate)),
  ]);
  const namesOfOpened = new Set(Array.from(opened, program => program.name));
  const isDrawnToOpenTheWorld = (program: Generated) => namesOfOpened.has(program.name);
  for (const [index, program] of chosen.entries())
    if (validated.has(program)) chosen[index] = { ...program, flags: ["--aot-validate"] };

  const readsLessOffWhatItHasCaught = (program: Generated) =>
    !staysAsItIs(program) &&
    (process.env.AOT_GENERATED_READS_LESS === "all" || Bun.hash.crc32(`${title} | ${program.name}`) % 8 === 0);
  function withLessReadOffWhatIsCaught(name: string, text: string): string {
    // It loads TypeScript, which few files need.
    const tool = require("../tools/let-values-be-something-else");
    return tool.write(tool.read(name, text), "caught@0-0") ?? text;
  }

  // Its objects, functions, classes or keys, or its receivers, arguments, callees or results, or all of them: what a build could prove about them it can only expect.
  // No run draws it by itself: an error of the engine quotes the text that failed, an executable quotes less of it (docs/compiler/compatibility.mdx), and a program that prints such words prints others then.
  const isLaundered = (program: Generated) =>
    process.env.AOT_GENERATED_LAUNDERS === "all" &&
    !staysAsItIs(program) &&
    !program.mayBeRefused &&
    !program.groupsMayBeRefused &&
    !program.printsInThisOrder &&
    !program.referenceIsCompiled;
  function withWhatItWorksOnLaundered(program: Generated, name: string, text: string): string {
    // It loads TypeScript, which few files need.
    const { laundered, whatIsLaundered } = require("../fuzz/what-a-program-works-on-comes-back-from-text-nobody-knows");
    const draw = Bun.hash.crc32(`${title} ~ ${program.name}`);
    return laundered(name, text, whatIsLaundered[draw % whatIsLaundered.length], new Random(draw)) ?? text;
  }

  function write(program: Generated, folder: string) {
    const { file, text, files, links, entryPoints = [] } = program.make();
    // The changes: a program keeps its short loops as loops, collects inside its calls, hands its functions to the host, stands inside a function, a try, a loop or the like, or opens the world. Where a run is told to, it works on what has come back from text that nobody knows.
    const isChanged = !staysAsItIs(program);
    const keepsItsLoops = isChanged && isDrawn(program, "turns", Bun.hash.crc32(`${title} ${program.name}`) % 2 === 1);
    const collectsInsideCalls =
      isChanged &&
      !program.mayStopOutOfMemory &&
      !program.hangsOnCollections &&
      (process.env.AOT_GENERATED_COLLECTS === "all" ||
        isDrawn(program, "collections", Bun.hash.crc32(`${program.name} ${title}`) % 3 === 0));
    const handsItsFunctionsOn =
      isChanged &&
      (process.env.AOT_GENERATED_HANDS === "all" ||
        isDrawn(program, "host", Bun.hash.crc32(`${program.name}, ${title}`) % 3 === 0));
    const standsInside =
      isChanged &&
      // What the analysis follows at the top of a file is what such a program is about.
      !program.flags?.some(flag => flag.startsWith("--aot-limit=MaxValueFlowEdgesLogged")) &&
      (process.env.AOT_GENERATED_INSIDE === "all" ||
        isDrawn(program, "inside", Bun.hash.crc32(`${program.name}; ${title}`) % 3 === 0));
    const place = places[Bun.hash.crc32(`${title}; ${program.name}`) % places.length];
    for (const [name, content] of Object.entries({ ...files, [file]: text })) {
      mkdirSync(dirname(join(folder, name)), { recursive: true });
      let written = content;
      if (/\.[cm]?[jt]s$/.test(name)) {
        const loader = name.endsWith("ts") ? "ts" : "js";
        if (isLaundered(program) && !name.endsWith(".d.ts") && !name.includes("node_modules/")) written = withWhatItWorksOnLaundered(program, name, written); // prettier-ignore
        if (readsLessOffWhatItHasCaught(program)) written = withLessReadOffWhatIsCaught(name, written);
        if (keepsItsLoops) written = withTurnsNobodyKnows(written);
        if (collectsInsideCalls) written = withCollectionsInsideCalls(written, loader);
        if (handsItsFunctionsOn) written = withFunctionsTheHostCouldCall(written, loader);
        if (name === file && isDrawnToOpenTheWorld(program)) written = withTheWorldOpen(written);
        if (standsInside && name === file) written = withTheWholeFileInside(written, loader, place);
      }
      writeFileSync(join(folder, name), written);
    }
    for (const [name, target] of Object.entries(links ?? {})) {
      const link = join(folder, name);
      mkdirSync(dirname(link), { recursive: true });
      rmSync(link, { force: true });
      symlinkSync(isWindows ? join(dirname(link), target) : target, link, "junction");
    }
    // In an executable that programs share, each runs in a Worker.
    const asksForItsThread = /\bisMainThread\b/.test(text);
    return { file, entryPoints, project: files?.["tsconfig.json"], asksForItsThread };
  }

  /** Builds the programs into one executable in `folder` and runs each. */
  async function runTogether(members: { program: Generated; index: number }[], folder: string) {
    const shared = new Map<Generated, Shared>();
    if (members.every(({ program }) => mayBeLeftOut(program)) && performance.now() > 200_000) {
      for (const { program } of members) shared.set(program, "left out");
      return shared;
    }
    mkdirSync(folder, { recursive: true });
    copyFileSync(join(import.meta.dir, "..", "fixtures", runner), join(folder, runner));
    const written = members.map(({ program, index }) => ({
      program,
      index,
      cwd: join(folder, String(index)),
      ...write(program, join(folder, String(index))),
    }));
    // The project of the first entry point governs a build.
    const project = written[0].project;
    if (project !== undefined) writeFileSync(join(folder, "tsconfig.json"), project);
    type Member = (typeof written)[number];
    const start = (command: string[], { index, file, cwd }: Member, env: Record<string, string | undefined>) => {
      const tasks = join(folder, `tasks-${index}.json`);
      writeFileSync(tasks, JSON.stringify([{ program: `./${index}/${file}`, cwd }]));
      return slot(async () => inItsWorker(await spawned(command, cwd, { ...env, AOT_TASKS: tasks, AOT_MARK: mark })));
    };
    const plain = new Map<Member, Run>();
    let together = written.filter(member => {
      if (member.entryPoints.length === 0 && member.project === project && !member.asksForItsThread) return true;
      shared.set(member.program, "alone");
    });
    await Promise.all(
      together.map(async member =>
        plain.set(member, await start([bunExe(), "run", join(folder, runner)], member, bunEnv)),
      ),
    );
    together = together.filter(member => {
      if (!member.program.mayBeUnjudgeable || plain.get(member)!.exitCode === 0) return true;
      shared.set(member.program, "nothing to compare");
    });
    // A build stops at the first entry point that TypeScript rejects. `bun check` names them all at once, and each of them is built alone, where its build has the say.
    // A build knows `console`, `process` and `Bun` where no typings are installed, and `bun check` does not: TS2584, TS2591 and TS2868 say only that.
    if (together.some(({ file }) => /\.[cm]?tsx?$/.test(file))) {
      const entries = together.map(({ index, file }) => `./${index}/${file}`);
      const check = await slot(() => spawned([bunExe(), "check", "--no-pretty", "--all", ...entries], folder, bunEnv));
      const errors = (check.stdout + check.stderr).matchAll(
        /^(\d+)[\\/][^(\n]+\(\d+,\d+\): error (?!TS(?:2584|2591|2868):)/gm,
      );
      const rejected = new Set(Array.from(errors, ([, index]) => Number(index)));
      together = together.filter(member => {
        if (!rejected.has(member.index)) return true;
        shared.set(member.program, "alone");
      });
    }
    const executable = join(folder, isWindows ? "programs.exe" : "programs");
    const report = join(folder, "report.json");
    const build = () =>
      slot(() =>
        spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...moreFlags,
            ...(members[0].program.flags ?? []),
            "--aot-report=" + report,
            "./" + runner,
            ...together.map(({ index, file }) => `./${index}/${file}`),
            "--outfile",
            executable,
          ],
          folder,
          bunEnv,
        ),
      );
    const isBuilt = ({ exitCode, stderr }: Run) => exitCode === 0 && !/^error\b/m.test(stderr);
    try {
      let result = together.length ? await build() : undefined;
      // The programs that the errors point into leave, and the others are built once more.
      while (result && !isBuilt(result)) {
        const { stderr } = result;
        const others = together.filter(({ index, file }) => !stderr.includes(`${sep}${index}${sep}${file}:`));
        if (others.length === together.length) break;
        for (const member of together) if (!others.includes(member)) shared.set(member.program, "alone");
        together = others;
        result = together.length ? await build() : undefined;
      }
      if (result && !isBuilt(result)) {
        console.error(
          `ALONE: ${together.length} programs, from ${together[0].program.name}: the build of all of them ended with ${result.signal ?? `exit code ${result.exitCode}`}: ${result.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 600)}`,
        );
        for (const { program } of together) shared.set(program, "alone");
        return shared;
      }
      if (result) {
        executables++;
        // The compiler runs once for each program of a build, the runner's among them. Where it has thrown those away to make one program of them, it has run once more.
        const { EngineRuns } = JSON.parse(readFileSync(report, "utf8")).statistics;
        shares[EngineRuns === together.length + 1 ? "a program each" : "one program"] += together.length;
      }
      await Promise.all(
        together.map(async member => {
          const compiled = await start([executable], member, { ...bunEnv, BUN_AOT_VERBOSE: "1" });
          const again: Run[] = [];
          for (const under of member.program.alsoUnder ?? [])
            again.push(await start([executable], member, { ...bunEnv, ...under }));
          shared.set(member.program, {
            entry: `${member.index}/${member.file}`,
            plain: plain.get(member)!,
            compiled,
            again,
            beside: together.length - 1,
          });
        }),
      );
      return shared;
    } finally {
      rmSync(executable, { force: true });
    }
  }

  const sharing = chosen
    .map((program, index) => ({ program, index }))
    .filter(({ program }) => !program.failsToday && sharesAnExecutable(program));
  let started: Map<Generated, Promise<Map<Generated, Shared>>> | undefined;
  /** The executables are begun when the first program asks, a few at a time, so that each looks at the clock when its turn has come. A test waits for its own. */
  function sharedOf(program: Generated) {
    if (!started) {
      started = new Map();
      const atWork: Promise<unknown>[] = Array(executablesAtOnce).fill(Promise.resolve());
      let begun = 0;
      let members: typeof sharing = [];
      let bytes = 0;
      const begin = () => {
        const mine = members;
        [members, bytes] = [[], 0];
        let run: Promise<Map<Generated, Shared>>;
        if (mine.length < fewestInOneExecutable)
          run = Promise.resolve(new Map(mine.map(({ program }): [Generated, Shared] => [program, "alone"])));
        else {
          const turn = begun++ % executablesAtOnce;
          const folder = join(root, title.replaceAll(" ", "-"), `together-${mine[0].index}`);
          run = atWork[turn].then(() => runTogether(mine, folder));
          atWork[turn] = run.catch(() => {});
        }
        for (const member of mine) started!.set(member.program, run);
      };
      const kindOf = ({ program }: (typeof sharing)[number]) =>
        `${flagsOf(program)} ${isDrawnToOpenTheWorld(program) || isOpenAsWritten(program)}`;
      for (const alike of Map.groupBy(sharing, kindOf).values()) {
        for (const member of alike) {
          const size = member.program.make().text.length;
          if (members.length === programsInOneExecutable || (members.length && bytes + size > bytesInOneExecutable))
            begin();
          members.push(member);
          bytes += size;
        }
        if (members.length) begin();
      }
    }
    return started.get(program)!.then(shared => shared.get(program)!);
  }

  function judgeShared(program: Generated, { entry, plain, compiled, again, beside }: Exclude<Shared, string>) {
    try {
      expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
      expect(compiled.stderr.replaceAll("\\", "/").split(/\r?\n/)).toContainEqual(
        expect.stringMatching(new RegExp(`^\\[aot\\] module: .*/${entry.replaceAll(".", "\\.")}$`)),
      );
      const [ours, theirs] = [compiled.stdout.split("\n"), plain.stdout.split("\n")];
      const departing: string[] = [];
      for (let i = 0; i < Math.max(ours.length, theirs.length) && departing.length < 20; i++) {
        if (ours[i] !== theirs[i]) departing.push(`--aot: ${ours[i]}\nplain: ${theirs[i]}`);
      }
      expect({
        departing,
        signal: compiled.signal,
        exitCode: compiled.exitCode,
        lines: ours.length,
        ...stderrOfFailure(compiled, 0),
      }).toEqual({ departing: [], signal: null, exitCode: 0, lines: theirs.length });
      for (const [index, under] of (program.alsoUnder ?? []).entries()) {
        const { stdout, signal, exitCode } = again[index];
        expect({ under, stdout, signal, exitCode, ...stderrOfFailure(again[index], 0) }).toEqual({
          under,
          stdout: plain.stdout,
          signal: null,
          exitCode: 0,
        });
      }
    } catch (error) {
      console.error(
        `${program.name}: one of ${beside + 1} programs in an executable. AOT_GENERATED_IN_ONE_EXECUTABLE=1 builds it alone`,
      );
      throw error;
    }
  }

  describe.concurrent(`compile/aot/generated/${title}`, () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    if (chosen.length === 0) test.skip("no program selected", () => {});
    chosen.forEach((program, index) => {
      if (program.failsToday) return void test.todo(program.name);
      if (program.modeFailsToday) test.todo(`${program.name}, by bun run --aot`);
      test(
        program.name,
        async () => {
          const shared = sharesAnExecutable(program) ? await sharedOf(program) : "alone";
          if (shared === "left out") return void leftOut++;
          if (shared === "nothing to compare") return;
          if (shared !== "alone") return judgeShared(program, shared);
          await slotFor(program)(async () => {
            if (mayBeLeftOut(program) && performance.now() > 200_000) return void leftOut++;
            const folder = join(root, title.replaceAll(" ", "-"), String(index));
            const { file, entryPoints } = write(program, folder);
            const executable = join(folder, isWindows ? "program.exe" : "program");
            const reference = join(folder, isWindows ? "reference.exe" : "reference");
            try {
              if (
                program.mayBeUnjudgeable &&
                (await spawned([bunExe(), "run", file], folder, { ...bunEnv, ...program.plainEnv })).exitCode !== 0
              )
                return;
              const build = await spawned(
                [
                  bunExe(),
                  "build",
                  "--compile",
                  "--aot",
                  ...moreFlags,
                  ...(program.flags ?? []),
                  ...(program.flagsOfBothBuilds ?? []),
                  file,
                  ...entryPoints,
                  "--outfile",
                  executable,
                ],
                folder,
                bunEnv,
              );
              // A compiler that stops says so and ends its build with 1, as a refusal does. It is none.
              const isRefused = build.exitCode === 1 && !/internal compiler error/.test(build.stderr);
              // What has come back from text that nobody knows has lost what the checker knew of it, and a type may not hold any more.
              if ((program.mayBeUnjudgeable || isLaundered(program)) && isRefused && /^error: TS\d+:/m.test(build.stderr)) return; // prettier-ignore
              const fromSources =
                program.modeFailsToday || program.groupsMayBeRefused || program.isOnlyCompiled
                  ? undefined
                  : await spawned([bunExe(), "run", "--aot", file], folder, bunEnv);
              if (program.mayBeRefused && isRefused && /^error\b/m.test(build.stderr))
                return void (fromSources && expect(fromSources.exitCode).not.toBe(0));
              built(build);
              executables++;
              const compiled = await spawned([executable], folder, { ...bunEnv, BUN_AOT_VERBOSE: "1" });
              if (fromSources)
                expect({
                  stdout: fromSources.stdout,
                  signal: fromSources.signal,
                  exitCode: fromSources.exitCode,
                }).toEqual({ stdout: compiled.stdout, signal: compiled.signal, exitCode: compiled.exitCode });
              if (program.referenceIsCompiled)
                built(
                  await spawned(
                    [
                      bunExe(),
                      "build",
                      "--compile",
                      ...(program.flagsOfBothBuilds ?? []),
                      file,
                      ...entryPoints,
                      "--outfile",
                      reference,
                    ],
                    folder,
                    bunEnv,
                  ),
                );
              const plain = await spawned(program.referenceIsCompiled ? [reference] : [bunExe(), "run", file], folder, {
                ...bunEnv,
                ...program.plainEnv,
              });
              const exitCode = program.exitsAsPlainBunDoes ? plain.exitCode : program.leavesAnError ? 1 : 0;
              expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode });
              expect(compiled.stderr).toContain("[aot] module: ");
              if (program.linesDepartToday) return void expect(compiled.signal).toBeNull();
              if (program.mayBeRefused && compiled.exitCode === 0 && compiled.stdout.startsWith("THROWS TypeError "))
                return;
              if (program.printsInThisOrder)
                return void expect({
                  lines: compiled.stdout.trimEnd().split("\n"),
                  sorted: compiled.stdout.split("\n").sort(),
                  signal: compiled.signal,
                  exitCode: compiled.exitCode,
                }).toEqual({
                  lines: program.printsInThisOrder,
                  sorted: plain.stdout.split("\n").sort(),
                  signal: null,
                  exitCode,
                });
              const written = Object.entries(program.written ?? {});
              const [ours, theirs] = [
                compiled.stdout.split("\n"),
                plain.stdout
                  .split("\n")
                  .map(line => written.find(([start]) => line.startsWith(start))?.join("") ?? line),
              ];
              if (program.groupsMayBeRefused)
                return void expect({
                  departing: departingGroups(ours, theirs, program.groupsMayBeRefused),
                  signal: compiled.signal,
                  exitCode: compiled.exitCode,
                }).toEqual({ departing: [], signal: null, exitCode: 0 });
              const departing: string[] = [];
              for (let i = 0; i < Math.max(ours.length, theirs.length) && departing.length < 20; i++) {
                if (ours[i] !== theirs[i]) departing.push(`--aot: ${ours[i]}\nplain: ${theirs[i]}`);
              }
              expect({
                departing,
                signal: compiled.signal,
                exitCode: compiled.exitCode,
                lines: ours.length,
                ...stderrOfFailure(compiled, exitCode),
              }).toEqual({
                departing: [],
                signal: null,
                exitCode,
                lines: theirs.length,
              });
              for (const under of program.alsoUnder ?? []) {
                const again = await spawned(
                  program.mayStopOutOfMemory ? withoutCoreDump([executable]) : [executable],
                  folder,
                  { ...bunEnv, ...(program.mayStopOutOfMemory && withoutCrashReport), ...under },
                );
                if (program.mayStopOutOfMemory && again.stderr.includes("FATAL: out of memory")) continue;
                expect({
                  under,
                  stdout: again.stdout,
                  signal: again.signal,
                  exitCode: again.exitCode,
                  ...stderrOfFailure(again, exitCode),
                }).toEqual({
                  under,
                  stdout: plain.stdout,
                  signal: null,
                  exitCode,
                });
              }
            } finally {
              rmSync(executable, { force: true });
              rmSync(reference, { force: true });
            }
          });
        },
        600_000,
      );
    });
  });
}
