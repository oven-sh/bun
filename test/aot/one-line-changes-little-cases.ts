// One line costs what that line costs. Nothing that a program says in one place switches something off for the whole program,
// for a whole class or for a whole object: how much of a program is compiled to direct loads and direct calls, and how much of
// Bun's library an executable holds, does not swing when a line is added.
//
// Each line of ./one-line-changes-little/lines.ts is built into a base program behind a test that never passes, so it never runs,
// and the report of that build is held against the report of the base alone.
//
//   library lines    beside `console.log("hello")`: the functions in the image and the bytes of code that the line adds
//   program lines    in the entry point of ./one-line-changes-little/program.ts, whose objects they name: the accesses and the
//                    calls of the program's own code that the line makes worse, and the bytes of code that the program's
//                    functions and module bodies grow by, the line's own code among them
//   the same lines   in program.js, the same program without types, beside a line that brings in a module of the library, as every
//                    real program has one: a line that costs nothing alone may cost a class once the library's own code is there
//                    to meet what it hands out. What a line takes from program.js alone it also takes there
//   ten of them      beside a line that brings in much of the library, where they cost something else than beside one module
//
// And types help: the typed program is compiled no worse than the untyped one.
//
// The lines that move more than that today stand in ./one-line-changes-little/known-today.ts with their numbers and are todo.
//
//   AOT_ONE_LINE=<text>    only the lines whose name contains the text
//
// A line is a build, so each group is dealt out over several files, one-line-changes-little-<part>.test.ts.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
import { wanted } from "./harness/shares";
import {
  knownBesideLibrary,
  knownBesideMuchOfTheLibrary,
  knownInLibrary,
  knownInTypedProgram,
  typedAgainstUntyped,
} from "./one-line-changes-little/known-today";
import { libraryLines, programLines, type Line } from "./one-line-changes-little/lines";
import { describe, test } from "./supported";

const mostFunctionsAdded = 120;
// The code of an image ends at a whole page of 16 KiB, so what a line adds is counted up to a page too high.
const page = 16384;
const mostCodeBytesAdded = 65536 + page;
// The constants lie behind the last page of the code and are counted with it.
const withoutConstants = (codeBytes: number) => codeBytes - (codeBytes % page);
const mostFreeAccessesLost = 3;
const mostAccessesByNameGained = 3;
const mostDirectCallsLost = 2;
const mostUnknownCallsGained = 2;
// What a line that takes nothing from the program adds to its code lies anywhere between nothing and 2,500 bytes, without a gap: its
// own code, and what the constructors do more once the order of the keys can be seen. A line that takes a class from the program
// adds 4,000 and more. The mark stands between the two.
const mostGrowthOfProgramCode = 0.25;
// An ASAN build emits four times the bytes for the same functions.
const mostCodeBytesOfLine = isASAN ? 4096 : 1024;
const mostAccessesByNameOfTypedOverUntyped = 1;
const mostCodeOfTypedOverUntyped = 0.08;

const program = readFileSync(join(import.meta.dir, "one-line-changes-little", "program.js"), "utf8");
const typedProgram = readFileSync(join(import.meta.dir, "one-line-changes-little", "program.ts"), "utf8");
const namesOfProgram = [...program.matchAll(/^export (?:class|const|function) (\w+)/gm)].map(match => match[1]);

// The compiler knows the answer of neither call, and neither brings in anything of the library.
const neverRuns = (code: string) => `const K = prompt();\nif (Date.now() < 0) {\n  ${code}\n}\n`;

const besideHello = (code: string) => ({
  "entry.js": `import "./line.js";\nconsole.log("hello");\n`,
  "line.js": `${neverRuns(code)}export {};\n`,
});

const insideProgram = (code: string) => ({
  "entry.js": `import { ${namesOfProgram.join(", ")} } from "./program.js";\n${neverRuns(code)}console.log(summary(run(world, options)));\n`,
  "program.js": program,
});

const besideLibrary = (code: string) =>
  insideProgram(`globalThis.kept = [process.argv, require("node:querystring").parse(K)];\n  ${code}`);
const besideMuchOfTheLibrary = (code: string) => insideProgram(`process.stdout.write(K);\n  ${code}`);
// Beside one module these pass and are known to fail beside much of the library, or the other way around.
const differBesideMuchOfTheLibrary = new Set([
  ...Object.keys(knownBesideMuchOfTheLibrary),
  "method-to-unknown",
  "new-function",
]);

// The checker is told nothing about the line: most of the lines are what it exists to refuse.
const insideTypedProgram = (code: string) => ({
  "entry.ts": `import { ${namesOfProgram.join(", ")} } from "./program.ts";\nconst K: any = prompt();\n// @ts-ignore\nif (Date.now() < 0) { ${code} }\nconsole.log(summary(run(world, options)));\n`,
  "program.ts": typedProgram,
  "globals.d.ts": `declare const console: { log(...values: unknown[]): void };\ndeclare function prompt(): string | null;\n`,
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      lib: ["ESNext"],
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      noEmit: true,
      strict: true,
      noUncheckedIndexedAccess: true,
      noImplicitOverride: true,
    },
  }),
});

async function measure(files: Record<string, string>) {
  using dir = tempDir("aot-one-line", files);
  const folder = String(dir);
  const report = join(folder, "report.json");
  const flags = ["--aot-report=" + report, "--aot-report-detail=functions"];
  const entry = "entry.ts" in files ? "./entry.ts" : "./entry.js";
  // The same compilation as a build's, and the same report. No executable is written, and none of these programs runs.
  built(await spawned([bunExe(), "check", "--aot", ...flags, entry], folder, bunEnv));
  const { statistics, summary, functions } = JSON.parse(readFileSync(report, "utf8"));
  // The report names no file for the body of a module, nor for the code that it shares between functions.
  const bodyRoles = ["Source", "CoroutineRamp", "CoroutineBody", "AsyncWorker"];
  const ofProgram = (functions as { file: string; role: string; codeBytes: number }[]).filter(
    ({ file, role }) => /program\.[jt]s$/.test(file) || (file === "" && bodyRoles.includes(role)),
  );
  return {
    functions: statistics.ImageFunctionsEmitted as number,
    codeBytes: statistics.CodeBytesEmitted as number,
    // Without the rest of the last page and without the constants. It is printed and judges nothing.
    exactCodeBytes:
      (statistics.SharedCodeBytesEmitted as number) +
      (functions as { codeBytes: number }[]).reduce((sum, { codeBytes }) => sum + codeBytes, 0),
    free: summary.accesses.free as number,
    byName: summary.accesses.byName as number,
    direct: summary.calls.proven as number,
    unknown: summary.calls.unknown as number,
    programCodeBytes: ofProgram.reduce((sum, { codeBytes }) => sum + codeBytes, 0),
  };
}

type Measured = Awaited<ReturnType<typeof measure>>;

function once<T>(work: () => Promise<T>) {
  let result: Promise<T> | undefined;
  return () => (result ??= work());
}

const moved = (name: string, from: number, to: number) => `${name} ${from} -> ${to}`;

function addedToLibrary(alone: Measured, withLine: Measured) {
  const found: string[] = [];
  if (withLine.functions > alone.functions + mostFunctionsAdded)
    found.push(moved("functions", alone.functions, withLine.functions));
  // An ASAN build emits four times the bytes for the same functions.
  if (!isASAN && withoutConstants(withLine.codeBytes) > withoutConstants(alone.codeBytes) + mostCodeBytesAdded)
    found.push(
      moved("bytes of code", alone.codeBytes, withLine.codeBytes) +
        ", " +
        moved("of functions and shared code alone", alone.exactCodeBytes, withLine.exactCodeBytes),
    );
  return found;
}

function lostInProgram(alone: Measured, withLine: Measured) {
  const found: string[] = [];
  if (withLine.free < alone.free - mostFreeAccessesLost) found.push(moved("free accesses", alone.free, withLine.free));
  if (withLine.byName > alone.byName + mostAccessesByNameGained)
    found.push(moved("accesses by name", alone.byName, withLine.byName));
  if (withLine.direct < alone.direct - mostDirectCallsLost)
    found.push(moved("direct calls", alone.direct, withLine.direct));
  if (withLine.unknown > alone.unknown + mostUnknownCallsGained)
    found.push(moved("unknown calls", alone.unknown, withLine.unknown));
  if (withLine.programCodeBytes > alone.programCodeBytes * (1 + mostGrowthOfProgramCode) + mostCodeBytesOfLine)
    found.push(moved("bytes of code of the program", alone.programCodeBytes, withLine.programCodeBytes));
  return found;
}

const only = process.env.AOT_ONE_LINE;
const isWanted = ([name]: Line, index: number) => (only ? name.includes(only) : wanted !== "quick" || index % 8 === 0);

function lines(
  piece: number,
  pieces: number,
  title: string,
  all: readonly Line[],
  known: Readonly<Record<string, string>>,
  filesFor: (code: string) => Record<string, string>,
  compare: (alone: Measured, withLine: Measured) => string[],
) {
  describe.concurrent(title, () => {
    const alone = once(() => slot(() => measure(filesFor("void 0;"))));
    for (const [name, code] of all.filter(isWanted).filter((_, index) => index % pieces === piece)) {
      const isKnown = name in known;
      (isKnown ? test.todo : test)(
        isKnown ? `${name}: ${code} (${known[name]})` : `${name}: ${code}`,
        async () => {
          const [base, withLine] = await Promise.all([alone(), slot(() => measure(filesFor(code)))]);
          expect(compare(base, withLine)).toEqual([]);
        },
        600_000,
      );
    }
  });
}

/** `part`: 1 to 8. */
export function oneLineChangesLittle(part: number) {
  const besideOneModule = programLines.filter(([name]) => !differBesideMuchOfTheLibrary.has(name));
  const besideMuch = programLines.filter(([name]) => differBesideMuchOfTheLibrary.has(name));
  if (part <= 2)
    lines(
      part - 1,
      2,
      "compile/aot/one line brings in little of the library",
      libraryLines,
      knownInLibrary,
      besideHello,
      addedToLibrary,
    );
  else if (part <= 4)
    lines(
      part - 3,
      2,
      "compile/aot/one line takes little from the typed program",
      programLines,
      knownInTypedProgram,
      insideTypedProgram,
      lostInProgram,
    );
  else if (part <= 7)
    lines(
      part - 5,
      3,
      "compile/aot/one line takes little from the program beside the library",
      besideOneModule,
      knownBesideLibrary,
      besideLibrary,
      lostInProgram,
    );
  else
    lines(
      0,
      1,
      "compile/aot/one line takes little from the program beside much of the library",
      besideMuch,
      knownBesideMuchOfTheLibrary,
      besideMuchOfTheLibrary,
      lostInProgram,
    );
  if (part === 8) typedAgainstUntypedProgram();
}

function typedAgainstUntypedProgram() {
  const typedAndUntyped = once(() =>
    Promise.all([slot(() => measure(insideProgram("void 0;"))), slot(() => measure(insideTypedProgram("void 0;")))]),
  );

  // The columns in which the typed program is no worse today. One that turns is a regression of the compiler: types may only add knowledge.
  // Where it is still worse, it may not get worse than it is.
  test("the typed program has no fewer free accesses and direct calls and no more unknown calls than the untyped one", async () => {
    const [untyped, typed] = await typedAndUntyped();
    const found: string[] = [];
    if (typed.free < untyped.free) found.push(moved("free accesses", untyped.free, typed.free));
    if (typed.direct < untyped.direct) found.push(moved("direct calls", untyped.direct, typed.direct));
    if (typed.unknown > untyped.unknown) found.push(moved("unknown calls", untyped.unknown, typed.unknown));
    if (typed.byName > untyped.byName + mostAccessesByNameOfTypedOverUntyped)
      found.push(moved("accesses by name", untyped.byName, typed.byName));
    if (typed.programCodeBytes > untyped.programCodeBytes * (1 + mostCodeOfTypedOverUntyped))
      found.push(moved("bytes of code of the program", untyped.programCodeBytes, typed.programCodeBytes));
    expect(found).toEqual([]);
  }, 600_000);

  test.todo(
    `the typed program is compiled no worse than the untyped one (${typedAgainstUntyped})`,
    async () => {
      const [untyped, typed] = await typedAndUntyped();
      const found: string[] = [];
      if (typed.byName > untyped.byName) found.push(moved("accesses by name", untyped.byName, typed.byName));
      if (typed.programCodeBytes > untyped.programCodeBytes)
        found.push(moved("bytes of code of the program", untyped.programCodeBytes, typed.programCodeBytes));
      expect(found).toEqual([]);
    },
    600_000,
  );

  test("every known line is a line", () => {
    const names = (all: readonly Line[]) => new Set(all.map(([name]) => name));
    expect(Object.keys(knownInLibrary).filter(name => !names(libraryLines).has(name))).toEqual([]);
    expect(Object.keys(knownInTypedProgram).filter(name => !names(programLines).has(name))).toEqual([]);
    expect(Object.keys(knownBesideLibrary).filter(name => !names(programLines).has(name))).toEqual([]);
    expect(Object.keys(knownBesideMuchOfTheLibrary).filter(name => !names(programLines).has(name))).toEqual([]);
  });
}
