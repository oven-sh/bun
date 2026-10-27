// The programs under ./programs, each written again in many ways by tools/let-values-be-something-else.ts: one of its values may, for all that the build can tell, also be something else, or
// it reaches the place where it is used by another road. What a build knows about a value it may use, and what it no longer knows it must do without: the executable prints what plain Bun
// prints for the same text.
//
// The variants of one program are the entry points of one executable, as in programs-as-separate-entry-points.ts: each begins a program of its own and runs in a Worker. A variant that may
// run code that its build has not seen has an executable of its own, and so has each variant of a program that is built alone there. Of a program with types, half the variants are built
// with the types erased. A variant whose types no longer check is passed over.
//
// A program has thousands of variants. A run takes three things:
//   - the lines of programs-whose-values-may-be-something-else.fixed.txt: <program>, a tab, <file>:<variant>. Every run takes them, in the unit values-that-may-be-something-else-in-every-run
//   - one program in `oneIn`, by the day and the lane of CI, and of each `variantsOfAProgram`, as many of one form as of another, by the day and the lane too. The name of a variant says all
//     that it takes to write it again, so a red of any day is seen again by its name
//   - TODO: the lines of programs-whose-values-may-be-something-else.known.txt: <program>, a tab, <file>:<variant> or a form, which stands for all variants of that form, a tab, what happens
//     today. Each is a todo: `bun test --todo` runs them, of a form as many as of any form
//
// Where a value that nobody knows stands beside a module loader, an evaluator of text, a member of the runtime or a store to a built-in object, an executable may say that it has not been
// built for that (docs/compiler/compatibility.mdx, "Code from strings" and "Built-in objects are read-only"). So in the forms that bring such a value (unknown, handed, written, several) one of those messages is no red. The line `SAID SO:`
// counts them. In the other forms nothing is there that the build does not see, and the message is a red.
//
// Where something else really comes (comes) a program mostly prints the messages of errors and the texts of functions, which quote the text of the program and are not the same in an
// executable. There the executable is only asked to be built, to run compiled code and to end by itself.
//
// Whatever is killed at its time limit is a red. A variant that does something else than its program (comes, inline, caught) is a program that nobody has run: plain Bun runs it before
// anything is built. One that does not end there is a red of the tool, which is not to write it: `whatTheEndHangsOn` there.
//
//   TEST_PART=aot/values-that-may-be-something-else-3 bun test test/aot/parts.test.ts   one part
//   AOT_PROGRAMS=<text> TEST_PART=aot/values-that-may-be-something-else bun test ..     the programs whose path contains the text
//   AOT_PROGRAMS_LISTED=<file> ..                                                       the programs that the file lists, one a line, as paths below ./programs without the extension, up to a tab
//   AOT_VARIANTS=<number> | all ..                                                      so many variants of each program
//   AOT_VARIANT=<text> ..                                                               the variants whose name, <file>:<variant>, contains the text; with a form in front of the @ alone, that form
//   AOT_PLAIN_BUN=<path> ..                                                             the Bun that says what is expected, in place of the one that is tested
//   AOT_REDS=<file> ..                                                                  gets a line for each variant that is red: <program>, a tab, <file>:<variant>, a tab, what happened
//   AOT_SAID_SO=<file> ..                                                               the same for each variant that says that it has not been built for a call
//   bun test/aot/tools/let-values-be-something-else.ts <file> <variant>                 prints the text of a variant
import { afterAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS, tempDir } from "harness";
import { availableParallelism } from "os";
import { basename, dirname, extname, join, relative } from "path";
import { shareNumber } from "./fresh-seed";
import {
  firstDifference,
  fromRunner,
  mark,
  optionsOf,
  runner,
  Way,
  whyAlone,
  whyLeftOut,
} from "./programs-as-separate-entry-points";
import {
  besideOf,
  find,
  hasTypes,
  inPrograms,
  isGroup,
  isToldWhatToTake,
  referenceEnv,
  slot,
  spawned,
  taken,
  takesWhatIsDrawn,
  told,
  unsupported,
  wanted,
  withoutCoreDump,
  withoutDebugInformation,
  type RunResult,
} from "./run-programs";
import { doesAsStored, list, read, write, type Variants } from "./tools/let-values-be-something-else";

const plainBun = process.env.AOT_PLAIN_BUN ?? bunExe();
// There are forty thousand programs, and a variant costs five to ten seconds of one processor.
const oneIn = isMacOS ? 1600 : 640;
const variantsOfAProgram = process.env.AOT_VARIANTS === "all" ? Infinity : Number(process.env.AOT_VARIANTS) || 26;
// A variant by itself costs many times what it costs among the others.
const variantsOfAProgramThatIsBuiltAlone = Math.min(variantsOfAProgram, Number(process.env.AOT_VARIANTS) || 8);
const drawsOfSeveral = 3;
// The programs end in a second or two.
const limitOfTheFirstRun = 30_000;
const variantsOfOneForm = 12;
const mostFilesOfAProgram = 12;
const today = Math.floor(Date.now() / 86_400_000);
const draw = today + shareNumber;
const isInShareOfToday = (name: string) =>
  Number(BigInt(Bun.hash("something else " + name)) % BigInt(oneIn)) === draw % oneIn;
const nameOf = (path: string) => besideOf(inPrograms(path)).replaceAll("\\", "/");
const isSource = (name: string) => /\.([cm]?[jt]s|tsx)$/.test(name) && !/\.d\.[cm]?ts$/.test(name);
// Which frames a stack lists, and their columns, goes by how an expression is written: plain Bun reads `[f][0]` as `f` before it runs.
const printsFrames = (name: string) => /^errors\/|stack|frames|columns|positions/.test(name);
// docs/compiler/compatibility.mdx says what these are about: a `require` helper of a bundler is known by its text, and so are the options that are written in an import call.
const goesByItsText = (name: string) => /imported-require|options-of-an-import/.test(name);
const startsWorkersOrProcesses = /\bWorker\b|worker_threads|child_process|\bcluster\b|Bun\.spawn|process\.execPath|\$`/;
const keepsSomethingOpen =
  /\bBun\.(serve|listen|connect|udpSocket)\b|\bcreateServer\b|\.listen\(|\bWebSocket\b|\bMessageChannel\b|\bMessagePort\b|\bBroadcastChannel\b|\bsetInterval\b|\breadline\b/;
const bringsWhatNobodyKnows = (variant: string) => /:(unknown|handed|written|several)@/.test(variant);
const saysThatItWasNotBuiltForTheCall =
  /this executable can't load a module from a dynamic path|was not compiled into this executable because your code never (?:uses|calls) it|this executable only runs code that was compiled into it|because built-in objects are read-only in a compiled executable|it isn't in this executable, which only runs code that was compiled into it|Code generation from strings disallowed for this context: the compiler couldn't tell/;

const linesOf = (file: string) =>
  readFileSync(join(import.meta.dir, file), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => line.split("\t"));
const fixed = Map.groupBy(linesOf("programs-whose-values-may-be-something-else.fixed.txt"), ([program]) => program);
const known = Map.groupBy(linesOf("programs-whose-values-may-be-something-else.known.txt"), ([program]) => program);
const isOf = (variant: string, variantOrForm: string) =>
  variant === variantOrForm || variant.includes(`:${variantOrForm}@`);

// An executable is as large as Bun, and a variant may come to have one of its own. So few programs are at work at once, each on a few variants.
let free = Math.max(2, (Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism()) >> 2);
const waiting: (() => void)[] = [];
async function oneOfFew<T>(work: () => Promise<T>): Promise<T> {
  if (free > 0) free--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else free++;
  }
}

const variantsBuiltAtOnce = 12;

/** The files of the program that are written again, as paths below the folder of its entry point. */
function filesOf(path: string): string[] {
  if (!/[\\/]main\.[a-z]+$/.test(path)) return [basename(path)];
  return readdirSync(dirname(path), { recursive: true, encoding: "utf8" })
    .filter(name => isSource(name) && !/(^|[\\/])node_modules[\\/]/.test(name))
    .map(name => name.replaceAll("\\", "/"))
    .sort()
    .slice(0, mostFilesOfAProgram);
}

/** As many of one form as of another, each form in an order of the day. */
function drawn(program: string, all: string[], count: number): string[] {
  if (all.length <= count) return all;
  const rankOf = new Map(all.map(variant => [variant, Bun.hash(`${draw} ${program} ${variant}`)]));
  const byForm = [...Map.groupBy(all, variant => /:([a-z]+)@/.exec(variant)![1]).values()].map(some =>
    some.sort((a, b) => (rankOf.get(a)! < rankOf.get(b)! ? -1 : 1)),
  );
  const chosen: string[] = [];
  for (let turn = 0; chosen.length < count; turn++)
    for (const some of byForm) if (turn < some.length && chosen.length < count) chosen.push(some[turn]);
  return chosen;
}

export const programsWhoseValuesMayBeSomethingElse = (part = 1, parts = 1) => define(part, parts, false);
export const variantsThatEveryRunTakes = () => define(1, 1, true);

function define(part: number, parts: number, takesTheFixedLines: boolean) {
  const folder = String(tempDir("aot-something-else", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  describe.concurrent(
    `compile/aot/values-that-may-be-something-else${takesTheFixedLines ? "-in-every-run" : ""}`,
    () => {
      if (unsupported) return void test.skip(unsupported, () => {});
      if (isASAN || isDebug) return void test.skip("such a build of Bun is many times slower", () => {});
      const listed = process.env.AOT_PROGRAMS_LISTED
        ? new Set(
            readFileSync(process.env.AOT_PROGRAMS_LISTED, "utf8")
              .split(/\r?\n/)
              .map(line => line.split("\t")[0]),
          )
        : undefined;
      const isNamed = listed !== undefined || wanted !== "";
      const hasLines = (name: string) => (takesTheFixedLines ? fixed.has(name) : known.has(name));
      const isDrawn = (name: string) =>
        !takesTheFixedLines &&
        (listed
          ? listed.has(name)
          : wanted !== ""
            ? name.includes(wanted)
            : takesWhatIsDrawn && (isToldWhatToTake || isInShareOfToday(name)));
      // Every part gets as many of the programs of the day as any other: CI gives each part the same time.
      const dealt = (some: string[]) => some.filter((_, index) => index % parts === part - 1);
      const all = find().filter(
        path =>
          /[\\/]/.test(inPrograms(path)) &&
          !isGroup(path) &&
          !printsFrames(nameOf(path)) &&
          !goesByItsText(nameOf(path)),
      );
      const chosen = taken(
        [
          ...dealt(all.filter(path => isDrawn(nameOf(path)))),
          ...dealt(all.filter(path => !isDrawn(nameOf(path)) && !isNamed && hasLines(nameOf(path)))),
        ],
        () => true,
      ).filter(path => !whyLeftOut(path) && !existsSync(besideOf(path) + ".expected.txt"));
      if (chosen.length === 0) return void test.skip("no program selected", () => {});

      // It stands for ./programs: a variant lies as deep below it as its program below ./programs, beside what the program names by a relative path.
      const root = join(folder, "programs");
      const kept = join(import.meta.dir, "programs");
      mkdirSync(root);
      for (const entry of readdirSync(kept, { withFileTypes: true }))
        if (entry.isFile() && entry.name !== "tsconfig.json")
          copyFileSync(join(kept, entry.name), join(root, entry.name));
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ extends: join(kept, "tsconfig.json") }));

      /** Lays what the text names by a relative path where the text finds it from `to`. */
      function layWhatIsNamed(from: string, to: string, text: string) {
        for (const [, , name] of text.matchAll(/(["'`])(\.\.?\/[^"'`\n]+)\1/g)) {
          const [source, target] = [join(dirname(from), name), join(dirname(to), name)];
          for (const suffix of ["", ".ts", ".js", ".mjs", ".cjs", ".tsx", ".mts", ".cts", ".json"]) {
            if (!existsSync(source + suffix) || existsSync(target + suffix) || relative(root, target).startsWith(".."))
              continue;
            cpSync(source + suffix, target + suffix, { recursive: true });
            if (isSource(source + suffix))
              layWhatIsNamed(source + suffix, target + suffix, readFileSync(source + suffix, "utf8"));
          }
        }
      }

      const carrier = withoutDebugInformation();
      const ways = [
        new Way("compiled", [], folder, carrier),
        new Way("compiled with types erased", ["--aot-erase-types"], folder, carrier),
      ];
      let written = 0;
      /** Writes the variant and answers its entry point. */
      function lay(path: string, files: Map<string, Variants>, variant: string): string | undefined {
        const [, file, change] = /^(.*):([^:]+)$/.exec(variant)!;
        const text = files.has(file) ? write(files.get(file)!, change) : undefined;
        if (text === undefined) return undefined;
        const inRoot = join(root, inPrograms(path));
        mkdirSync(dirname(inRoot), { recursive: true });
        for (let at = dirname(path), to = dirname(inRoot); to !== root; at = dirname(at), to = dirname(to))
          if (existsSync(join(at, "tsconfig.json")) && !existsSync(join(to, "tsconfig.json")))
            copyFileSync(join(at, "tsconfig.json"), join(to, "tsconfig.json"));
        const number = written++;
        if (!/[\\/]main\.[a-z]+$/.test(path)) {
          const entry = join(dirname(inRoot), `${basename(path, extname(path))}-${number}${extname(path)}`);
          writeFileSync(entry, text);
          layWhatIsNamed(path, entry, text);
          return entry;
        }
        const copy = `${dirname(inRoot)}-${number}`;
        cpSync(dirname(path), copy, { recursive: true });
        writeFileSync(join(copy, file), text);
        for (const [name, { text }] of files) layWhatIsNamed(join(dirname(path), name), join(copy, name), text);
        return join(copy, basename(path));
      }

      type Ran = { stdout: string; stderr: string; exitCode: number; signal: number | NodeJS.Signals | null };
      const envOf = (command: string[]) => (command[0] === plainBun ? referenceEnv : bunEnv);
      let lists = 0;
      async function runInWorker(
        command: string[],
        cwd: string,
        spelled: string,
        env: Record<string, string> | undefined,
        limit?: number,
      ): Promise<Ran> {
        const tasks = join(folder, `tasks-${lists++}.json`);
        writeFileSync(tasks, JSON.stringify([{ program: spelled, cwd, env }]));
        const ran = await slot(() =>
          spawned(
            withoutCoreDump(command),
            cwd,
            { ...envOf(command), BUN_AOT_VERBOSE: "1", AOT_TASKS: tasks, AOT_MARK: mark },
            limit,
          ),
        );
        rmSync(tasks, { force: true });
        const parts = (text: string) => text.split(new RegExp(`\\r?\\n${mark} (-?[0-9]+)\\r?\\n`));
        const [stdout, stderr] = [parts(ran.stdout), parts(ran.stderr)];
        if (Math.min(stdout.length, stderr.length) > 1)
          return { stdout: stdout[0], stderr: stderr[0], exitCode: Number(stdout[1]), signal: null };
        return { stdout: stdout[0], stderr: stderr[0], exitCode: ran.exitCode, signal: ran.signal };
      }
      const runOnMainThread = (
        command: string[],
        cwd: string,
        env: Record<string, string> | undefined,
        limit?: number,
      ): Promise<Ran> =>
        slot(() => spawned(withoutCoreDump(command), cwd, { ...envOf(command), ...env, BUN_AOT_VERBOSE: "1" }, limit));
      const runPlain = (entry: string, inWorker: boolean, env: Record<string, string> | undefined, limit?: number) =>
        inWorker
          ? runInWorker([plainBun, "run", join(root, runner)], dirname(entry), entry, env, limit)
          : runOnMainThread([plainBun, "run", entry], dirname(entry), env, limit);
      // A message for a value that is not what an operation takes quotes the text of the program, and a frame has a column.
      const withoutTheText = (result: RunResult) => ({
        ...result,
        stderr: result.exitCode ? result.stderr.replace(/:.*$/s, "") : result.stderr,
      });

      let [judged, saidSo, passedOver] = [0, 0, 0];
      /** What is red about the variants of the program, a line each. */
      async function judge(path: string, variants: string[]): Promise<string[]> {
        const name = nameOf(path);
        const { env } = optionsOf(path);
        const files = new Map(
          filesOf(path).map(file => [file, read(file, readFileSync(join(dirname(path), file), "utf8"))]),
        );
        const isAlone = whyAlone(path) !== undefined;
        const entries = new Map<string, string>();
        for (const variant of variants) {
          const entry = lay(path, files, variant);
          if (entry) entries.set(entry, variant);
        }
        const isTyped = hasTypes(path);
        const wayOf = new Map([...entries.keys()].map((entry, index) => [entry, ways[isTyped ? index & 1 : 0]]));
        const reds: string[] = [];
        const red = (variant: string, way: Way, what: string) => {
          if (process.env.AOT_REDS)
            appendFileSync(
              process.env.AOT_REDS,
              `${name}\t${variant}\t${way.name}: ${what.replaceAll("\n", " | ").slice(0, 400)}\n`,
            );
          reds.push(
            `${variant}, ${way.name}: ${what}\n    AOT_PROGRAMS=${name} AOT_VARIANT=${variant} TEST_PART=aot/values-that-may-be-something-else bun test test/aot/parts.test.ts`,
          );
        };
        const asStored = new Map<boolean, Promise<RunResult>>();
        const expectedAsStored = (inWorker: boolean) =>
          asStored.get(inWorker) ?? asStored.set(inWorker, runPlain(path, inWorker, env).then(told)).get(inWorker)!;

        async function judgeOne(entry: string, way: Way) {
          const variant = entries.get(entry)!;
          using _ = { [Symbol.dispose]: () => way.alone.has(entry) && way.remove([entry]) };
          const refused = way.refused.get(entry);
          const inWorker = !way.alone.has(entry) && refused === undefined;
          if (refused !== undefined) {
            // The types of the variant no longer check, or it is no program: plain Bun says so too.
            if (/\bTS[0-9]+\b/.test(refused) && !/internal compiler error/.test(refused)) return void passedOver++;
            const plain = await runPlain(entry, false, env);
            if (plain.exitCode !== 0 && /^(error|SyntaxError)\b/m.test(plain.stderr)) return void passedOver++;
            return red(variant, way, `it is not built: ${refused}`);
          }
          const ran = await (inWorker
            ? runInWorker([way.executableOf.get(entry)!], dirname(entry), fromRunner(root, entry), env)
            : runOnMainThread([way.executableOf.get(entry)!], dirname(entry), env));
          judged++;
          if (ran.signal !== null) return red(variant, way, `${ran.signal}: ${ran.stderr.slice(0, 300)}`);
          if (!ran.stderr.includes("[aot] module: "))
            return red(
              variant,
              way,
              `it did not run compiled code: exit code ${ran.exitCode}: ${ran.stderr.slice(0, 300)}`,
            );
          if (variant.includes(":comes@")) return;
          const result = told({ ...ran, stderr: ran.stderr.replace(/^\[aot\] .*\r?\n/gm, "") });
          if (
            doesAsStored(variant.slice(variant.lastIndexOf(":") + 1)) &&
            Bun.deepEquals(result, await expectedAsStored(inWorker))
          )
            return;
          const plain = await runPlain(entry, inWorker, env);
          if (plain.signal === "SIGKILL")
            return red(variant, way, "plain Bun does not end it within the limits of a run");
          if (plain.signal !== null) return void passedOver++;
          const expected = told(plain);
          if (Bun.deepEquals(withoutTheText(result), withoutTheText(expected))) return;
          if (bringsWhatNobodyKnows(variant) && saysThatItWasNotBuiltForTheCall.test(ran.stderr + ran.stdout)) {
            if (process.env.AOT_SAID_SO)
              appendFileSync(
                process.env.AOT_SAID_SO,
                `${name}\t${variant}\t${saysThatItWasNotBuiltForTheCall.exec(ran.stderr + ran.stdout)![0]}\n`,
              );
            return void saidSo++;
          }
          // What hangs on time or on the order of two processes is asked once more.
          const again = await (inWorker
            ? runInWorker([way.executableOf.get(entry)!], dirname(entry), fromRunner(root, entry), env)
            : runOnMainThread([way.executableOf.get(entry)!], dirname(entry), env));
          const [second, secondExpected] = [
            told({ ...again, stderr: again.stderr.replace(/^\[aot\] .*\r?\n/gm, "") }),
            told(await runPlain(entry, inWorker, env)),
          ];
          if (again.signal === null && Bun.deepEquals(withoutTheText(second), withoutTheText(secondExpected))) return;
          red(variant, way, firstDifference(withoutTheText(result), withoutTheText(expected)));
        }

        await Promise.all(
          [...entries].map(async ([entry, variant]) => {
            if (doesAsStored(variant.slice(variant.lastIndexOf(":") + 1))) return;
            // On the main thread: a Worker ends where its file waits for a promise that nobody settles.
            if ((await runPlain(entry, false, env, limitOfTheFirstRun)).signal !== "SIGKILL") return;
            red(
              variant,
              wayOf.get(entry)!,
              `plain Bun does not end it in ${limitOfTheFirstRun / 1000} s: nothing was built`,
            );
            entries.delete(entry);
            rmSync(/[\\/]main\.[a-z]+$/.test(entry) ? dirname(entry) : entry, { recursive: true, force: true });
          }),
        );
        await Promise.all(
          ways.map(async way => {
            const mine = [...entries.keys()].filter(entry => wayOf.get(entry) === way);
            if (isAlone) {
              for (let first = 0; first < mine.length; first += variantsBuiltAtOnce)
                await Promise.all(
                  mine
                    .slice(first, first + variantsBuiltAtOnce)
                    .map(entry => way.buildAlone(entry).then(() => judgeOne(entry, way))),
                );
              return;
            }
            for (let first = 0; first < mine.length; first += variantsBuiltAtOnce) {
              const some = mine.slice(first, first + variantsBuiltAtOnce);
              await way.build(root, some);
              reds.push(...way.internalErrors.splice(0), ...way.notBuiltTogether.splice(0));
              await Promise.all(some.map(entry => judgeOne(entry, way)));
              way.remove(some);
            }
          }),
        );
        for (const entry of entries.keys())
          rmSync(/[\\/]main\.[a-z]+$/.test(entry) ? dirname(entry) : entry, { recursive: true, force: true });
        return reds;
      }

      const only = process.env.AOT_VARIANT;
      const isAsked = (variant: string) => only === undefined || isOf(variant, only) || variant.includes(only);
      for (const path of chosen) {
        const name = nameOf(path);
        const isKnown = (variant: string) =>
          !isNamed && !!known.get(name)?.some(([, variantOrForm]) => isOf(variant, variantOrForm));
        const allVariants = () => {
          const texts = new Map(filesOf(path).map(file => [file, readFileSync(join(dirname(path), file), "utf8")]));
          // Where something else comes in the place of a test, a program that starts a Worker or a process only on the main thread starts them without end.
          const startsOthers = [...texts.values()].some(text => startsWorkersOrProcesses.test(text));
          // A program that has opened a server, a socket, a port or a timer ends where it closes it. Where it does something else it may never come there.
          const waitsToClose = [...texts.values()].some(text => keepsSomethingOpen.test(text));
          return [...texts].flatMap(([file, text]) => {
            const variants = read(file, text);
            return [
              ...list(variants, draw).filter(
                variant =>
                  !((startsOthers || waitsToClose) && variant.startsWith("comes@")) &&
                  !(waitsToClose && variant.startsWith("inline@")),
              ),
              ...Array.from(
                { length: drawsOfSeveral },
                (_, index) => `several@${(draw * drawsOfSeveral + index) % 100_000}`,
              ),
            ].map(variant => `${file}:${variant}`);
          });
        };
        test(
          name,
          async () => {
            const always = takesTheFixedLines ? fixed.get(name)!.map(([, variant]) => variant) : [];
            const all = isDrawn(name) ? allVariants().filter(variant => !isKnown(variant)) : [];
            const count = whyAlone(path) === undefined ? variantsOfAProgram : variantsOfAProgramThatIsBuiltAlone;
            const variants = [...new Set([...always, ...drawn(name, all.filter(isAsked), count)])].filter(
              variant => !isKnown(variant),
            );
            expect(await oneOfFew(() => judge(path, variants))).toEqual([]);
          },
          1_500_000,
        );
        if (isNamed || takesTheFixedLines) continue;
        for (const [, variantOrForm, what] of known.get(name) ?? [])
          test.todo(
            `${name} ${variantOrForm} (${what})`,
            async () =>
              expect(
                await oneOfFew(() =>
                  judge(
                    path,
                    drawn(
                      name,
                      allVariants().filter(variant => isOf(variant, variantOrForm)),
                      variantsOfOneForm,
                    ),
                  ),
                ),
              ).toEqual([]),
            1_500_000,
          );
      }

      afterAll(() =>
        console.error(
          `SAID SO: of ${judged} variants that ran, ${saidSo} said that they had not been built for a call; ${passedOver} more were passed over`,
        ),
      );
    },
  );
}
