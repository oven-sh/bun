// The speed of the programs of ./idioms, ./everyday and ./operations is pinned in executed instructions, which need hardware counters that most CI machines do
// not have. This reads the generated code instead. Nothing runs and nothing is counted by hardware, so it judges on every machine.
//
// The front end writes each program (`bun compile --aot-out`), and testaot generates code for the functions of the program's own file and says how large it is
// (`testaot print <program> --command="lower-to-air size loops entry-modules"`): Air instructions and patchpoints in the blocks that are reached without a rare edge.
//
//   an idiom       each function by its name, as `all`: [instructions, patchpoints] of the function, and `loop`: [step, instructions, patchpoints] of its cheapest loop per
//                  element, where `step` is what the counter advances by (8: unrolled eight times)
//   an operation   [instructions, patchpoints] per site: the function with 12 sites less the one with 4, over 8, as ./operations.test.ts counts executed instructions
//
// A bounds check, a poll, a conversion, a spill or a call that gets into the code raises a number. Held against ./generated-code-of-idioms.<os>-<arch>.txt and
// ./generated-code-of-operations.<os>-<arch>.txt. A program that has no line there, and every program on a platform without such a file, is printed and not
// judged: ./pins-from-a-log.ts writes the files from the log.
//
// The code behind a patchpoint is not counted, so a change that puts the fast path of a callee in line makes the program faster and a number here larger. A change
// that moves a number on purpose restates it, for both architectures: AOT_PERF=update with AOT_PERF_ONLY. Any other rise is a loss to look into.
//
//   TEST_PART=aot/perf/generated-code-of-idioms bun test test/aot/parts.test.ts       fails if a patchpoint was added, or more than 10% AND more than 1 instruction;
//                                                                                     a patchpoint counts for 8 instructions, and a lower sum is never worse;
//                                                                                     the poll of a loop counts for the instructions that it is, and as no patchpoint;
//                                                                                     the function and its loop are each held against their own pin
//   AOT_PERF=lower ..                                                                 writes every number that got better into the file
//   AOT_PERF=update ..                                                                writes every number as measured into the file
//   AOT_PERF_ONLY='^array/' ..                                                        only the programs whose name matches the regular expression
//   AOT_PERF_OPTION_WORDS='disable=b3:UnrollLoops' ..                                 option words for testaot: to see what fails without one optimization
//
// To see the code: `testaot print <program> --command="lower-to-air loops entry-modules"`. The engine's aot/tests/codegen has B3 tests of the same lowerings.
import { afterAll, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { join } from "path";
import { withProgramOutput } from "../harness/flags";
import { describe, test } from "../harness/printed-ir";
import { slot, spawned } from "../harness/commands";
import { testaot, toolEnv } from "../shell/tools";
import { writeEverydayIdioms } from "./everyday-idioms";
import { writeTypedIdioms, writeUntypedIdioms } from "./untyped-idioms";

const mode = process.env.AOT_PERF;
const only = new RegExp(process.env.AOT_PERF_ONLY ?? "");
const optionWords = (process.env.AOT_PERF_OPTION_WORDS ?? "").split(" ").filter(Boolean);
const platform = `${process.platform}-${process.arch}`;
const skipped = isASAN ? "with a sanitizer compiled code checks each access" : undefined;

type Size = { instructions: number; patchpoints: number };
// testaot counts the poll of a loop among the patchpoints and says how many there are. On x64 it is one load that faults when the thread is asked for; elsewhere a load and a branch.
const instructionsForPoll = process.arch === "x64" ? 1 : 2;
type Loop = Size & { step: number };
type Copy = Size & { loops: Loop[] };

// These only check arguments and pass them on, or serve callers that typed code does not have.
const rolesLeftOut = new Set(["EntryChecks", "GenericVersion", "GenericEntrypoint"]);

// The body of the module, and arrow functions that no variable names.
const unnamed = "(unnamed)";

/** By name: the copies of each function that testaot printed. */
function parseSizes(output: string) {
  const copies = new Map<string, Copy[]>();
  let name: string | undefined;
  let copy: Copy | undefined;
  for (const line of output.split("\n")) {
    const heading = /^function f\d+(?: name="(.*)")? role=(\w+)$/.exec(line);
    if (heading) {
      name = undefined;
      if (rolesLeftOut.has(heading[2])) continue;
      name = heading[1] ?? unnamed;
      continue;
    }
    const size = name !== undefined && /^(loop #\d+, )?instructions: (\d+), patchpoints: (\d+)(.*)$/.exec(line);
    if (!size) continue;
    const polls = Number(/, polls: (\d+)/.exec(size[4])?.[1] ?? 0);
    const [instructions, patchpoints] = [Number(size[2]) + instructionsForPoll * polls, Number(size[3]) - polls];
    if (!size[1]) {
      copy = { instructions, patchpoints, loops: [] };
      copies.set(name!, [...(copies.get(name!) ?? []), copy]);
    } else if (!size[4].endsWith(", entered rarely")) {
      const steps = [...size[4].matchAll(/ steps by (-?\d+)/g)].map(step => Math.abs(Number(step[1])));
      copy!.loops.push({ instructions, patchpoints, step: Math.max(1, ...steps) });
    }
  }
  return copies;
}

async function measure(folder: string, source: string, program: string, words: string, functions?: string[]) {
  const executable = `${program}.exe`;
  const compiled = await spawned(
    [bunExe(), "compile", withProgramOutput(program), source, "--outfile", executable],
    folder,
    bunEnv,
  );
  rmSync(executable, { force: true });
  expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const printed = await spawned(
    [
      testaot!,
      "print",
      program,
      `--command=lower-to-air ${words}`,
      ...(functions ? [`--aotFunctionToDump=${functions.join("|")}`] : []),
      ...optionWords,
    ],
    folder,
    toolEnv,
  );
  rmSync(program, { force: true });
  // testaot has no code for a few operations of Bun's own built-ins. It says so, ends with 1 and prints no size for such a function.
  // A notice about a regular expression may stand in front of it.
  const lacksCode = printed.exitCode === 1 && /^OpcodeWithoutCode: /m.test(printed.stderr);
  expect({ stderr: printed.stderr, exitCode: printed.exitCode }).toEqual({
    stderr: expect.any(String),
    exitCode: lacksCode ? 1 : 0,
  });
  return parseSizes(printed.stdout.replaceAll("\r\n", "\n"));
}

type Count = [instructions: number, patchpoints: number];
// A patchpoint is a call or a stub. Where one goes away, the code that does its work in line may take this many instructions, and loops are ranked by the sum.
const instructionsForPatchpoint = 8;
const costOf = ([instructions, patchpoints]: Count) => instructions + instructionsForPatchpoint * patchpoints;

function whyMore(now: Count, pin: Count, slack: number) {
  if (costOf(now) < costOf(pin)) return;
  if (now[1] > pin[1]) return "more patchpoints";
  const allowed = Math.max(pin[0] * 1.1, pin[0] + slack) + instructionsForPatchpoint * (pin[1] - now[1]);
  if (now[0] > allowed) return "more instructions";
}

const rounded = (count: number) => Math.round(count * 1000) / 1000;

// A line of a file of pins: the program's name, a tab, the pin as JSON. The parts of a unit that run in one process share the pins, and each writes all of them.
const pinsByFile = new Map<string, Record<string, unknown>>();
function readPins<T>(name: string) {
  const path = join(import.meta.dir, `${name}.${platform}.txt`);
  if (!pinsByFile.has(path)) {
    const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
    pinsByFile.set(
      path,
      Object.fromEntries(lines.map(line => line.split("\t")).map(([key, pin]) => [key, JSON.parse(pin)])),
    );
  }
  const pins = pinsByFile.get(path) as Record<string, T>;
  const write = () => {
    if (mode !== "lower" && mode !== "update") return;
    const lines = Object.entries(pins)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, pin]) => `${key}\t${JSON.stringify(pin)}\n`);
    writeFileSync(path, lines.join(""));
  };
  return { pins, write };
}

/** `all`: [instructions, patchpoints] of the function. `loop`: [step, instructions, patchpoints] of its cheapest loop per element. */
type Loop3 = [step: number, instructions: number, patchpoints: number];
type Code = { all: Count; loop?: Loop3 };
const forms = ["typed", "untyped"] as const;
type IdiomPin = Record<(typeof forms)[number], Record<string, Code>>;

function codeOf(copies: Copy[]): Code {
  const sum = (count: (copy: Copy) => number) => copies.reduce((total, copy) => total + count(copy), 0);
  const all: Code["all"] = [sum(copy => copy.instructions), sum(copy => copy.patchpoints)];
  const loops = copies.flatMap(copy => copy.loops);
  if (!loops.length) return { all };
  const perElement = (loop: Loop) => costOf([loop.instructions, loop.patchpoints]) / loop.step;
  const cheapest = loops.reduce((best, loop) => (perElement(loop) < perElement(best) ? loop : best));
  return { all, loop: [cheapest.step, cheapest.instructions, cheapest.patchpoints] };
}

/** The counts of a loop for as many elements as a turn of `like` handles. */
const scaledTo = ([step, ...count]: Loop3, [likeStep]: Loop3): Count => [
  (count[0] * likeStep) / step,
  (count[1] * likeStep) / step,
];

function whyWorse(now: Code, pin: Code) {
  if (!now.loop !== !pin.loop) return pin.loop ? "it has no loop now" : "it has a loop now";
  if (now.loop && pin.loop) {
    const why = whyMore(scaledTo(now.loop, pin.loop), scaledTo(pin.loop, pin.loop), 1);
    if (why) return `${why} in the loop`;
  }
  return whyMore(now.all, pin.all, 1);
}

function lower(now: Code, pin: Code): Code {
  const isLoopBetter =
    !!now.loop && !!pin.loop && costOf(scaledTo(now.loop, pin.loop)) < costOf(scaledTo(pin.loop, pin.loop));
  const all = costOf(now.all) < costOf(pin.all) ? now.all : pin.all;
  const loop = isLoopBetter ? now.loop : pin.loop;
  return loop ? { all, loop } : { all };
}

export function generatedCodeOfIdioms(part = 1, parts = 1) {
  if (skipped) console.error(`SKIPPED: test/aot/perf/generated-code.ts: ${skipped}`);
  describe.skipIf(!!skipped)("compile/aot/perf/generated-code-of-idioms", () => {
    if (skipped) return;
    const { pins, write } = readPins<IdiomPin>("generated-code-of-idioms");
    const pinnedInInstructions = ["pins.linux-x64.json", "everyday-pins.linux-x64.json"].flatMap(file =>
      Object.keys(JSON.parse(readFileSync(join(import.meta.dir, file), "utf8"))),
    );
    const root = String(tempDir("aot-generated-code-of-idioms", {}));
    const folders = { typed: join(root, "typed"), untyped: join(root, "untyped") };
    writeTypedIdioms(folders.typed);
    writeUntypedIdioms(folders.untyped);
    writeEverydayIdioms(folders.typed, folders.untyped);
    mkdirSync(join(root, "programs"));
    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
      write();
    });

    for (const [index, name] of pinnedInInstructions.entries()) {
      if (index % parts !== part - 1 || !only.test(name)) continue;
      test.concurrent(
        name,
        async () => {
          const now = {} as IdiomPin;
          for (const form of forms) {
            const source = name + (form === "typed" ? ".ts" : ".js");
            const program = join(root, "programs", `${index}-${form}.aot`);
            const copies = await slot(() => measure(folders[form], source, program, "size loops entry-modules"));
            now[form] = Object.fromEntries([...copies].map(([name, copies]) => [name, codeOf(copies)]));
          }
          console.error(`GENERATED-IDIOM ${name}\t${JSON.stringify(now)}`);
          const pin = pins[name];
          if (mode === "update" || (mode === "lower" && !pin)) return void (pins[name] = now);
          if (!pin) return;
          const worse: string[] = [];
          for (const form of forms)
            for (const [name, code] of Object.entries(now[form])) {
              const pinned = pin[form][name];
              const why = pinned && whyWorse(code, pinned);
              if (why) worse.push(`${form} ${name}: ${why}`);
              else if (mode === "lower") pin[form][name] = pinned ? lower(code, pinned) : code;
            }
          expect({ worse, now, pin }).toEqual({ worse: [], now, pin });
        },
        300_000,
      );
    }
  });
}

/** [instructions, patchpoints] per site. */
type Site = [instructions: number, patchpoints: number];
const columns = ["alone", "opened"] as const;
type OperationPin = Record<(typeof columns)[number], Site>;

export function generatedCodeOfOperations(part = 1, parts = 1) {
  const python = Bun.which("python3");
  const why = skipped ?? (python ? undefined : "python3 is not installed");
  if (why) console.error(`SKIPPED: test/aot/perf/generated-code.ts: the operations: ${why}`);
  describe.skipIf(!!why)("compile/aot/perf/generated-code-of-operations", () => {
    if (why) return;
    const { pins, write } = readPins<OperationPin>("generated-code-of-operations");
    const root = String(
      tempDir("aot-generated-code-of-operations", {
        "tsconfig.json": JSON.stringify({ extends: join(import.meta.dir, "operations", "tsconfig.json") }),
      }),
    );
    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
      write();
    });
    const generated = Bun.spawnSync({
      cmd: [python!, join(import.meta.dir, "operations", "generate.py"), root],
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    if (generated.exitCode !== 0) throw new Error(`generate.py ended with ${generated.exitCode}:\n${generated.stderr}`);
    // name, group, the row whose cost is contained in this one, does a site take long, is it written in TypeScript | Go | C++, ..
    const rows = readFileSync(join(root, "rows.tsv"), "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(fields => fields[4] === "1")
      .map(fields => fields[0]);

    for (const [index, name] of rows.entries()) {
      if (index % parts !== part - 1 || !only.test(name)) continue;
      test.concurrent(
        name,
        async () => {
          const now = {} as OperationPin;
          for (const column of columns) {
            const program = join(root, `${name}-${column}.aot`);
            const functions = [`${name}_4`, `${name}_12`];
            const copies = await slot(() => measure(root, join(column, `${name}.ts`), program, "size", functions));
            const [few, many] = functions.map(name => codeOf(copies.get(name) ?? []).all);
            now[column] = [rounded((many[0] - few[0]) / 8), rounded((many[1] - few[1]) / 8)];
          }
          console.error(`GENERATED-OPERATION ${name}\t${JSON.stringify(now)}`);
          const pin = pins[name];
          if (mode === "update" || (mode === "lower" && !pin)) return void (pins[name] = now);
          if (!pin) return;
          const worse = columns.flatMap(column => {
            const why = whyMore(now[column], pin[column], 0.25);
            return why ? [`${column}: ${why}`] : [];
          });
          if (mode === "lower")
            for (const column of columns)
              if (!whyMore(now[column], pin[column], 0.25) && costOf(now[column]) < costOf(pin[column]))
                pin[column] = now[column];
          expect({ worse, now, pin }).toEqual({ worse: [], now, pin });
        },
        300_000,
      );
    }
  });
}
