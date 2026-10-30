// A row of the table of built-ins that forgets a throw is wrong code: the compiler takes a call away with its unused result, and the error with
// it. Whether native code throws where a row says it does not is asked of every row without a compiler: differential.test.ts. Here the compiler
// is asked what it makes of the rows. Of the rows that make the same claims the first stands for all: its call, construction or read is made
// with operands that are missing, of the wrong kind or extreme, with another receiver, with and without `new`: in a declaration that nothing
// reads, in a statement, and with its result kept, in plain Bun and compiled. All must do the same: return, or throw an error of the same name,
// message and code. Of the expressions that end in the same error the first is then compiled once more as the one statement of a module of its
// own, where a whole statement may be left out: one more program loads all those modules. unused-calls/cases.ts makes the programs from the
// table in this build of Bun.
//
//   AOT_UNUSED_CALLS=<r>  only the expressions that match the regular expression ("^Object", "MODULE_")
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned } from "../harness/commands";
import { compileCommand } from "../harness/flags";
import { describe, test } from "../supported";
import type { TableDump } from "./differential/table-description";
import { CaseMaker, modulesOf, programOf } from "./unused-calls/cases";

const env = { ...bunEnv, NO_COLOR: "1" };
const filter = new RegExp(process.env.AOT_UNUSED_CALLS ?? ".");
const expressionsPerProgram = 1200;

const dump: TableDump = aotBuiltinEntries();
const { modules, expressions: everyExpression, leftOut, overloads } = new CaseMaker(dump).make(dump);
const expressions = everyExpression.filter(expression => filter.test(expression));
let plainBunDiffersFromItself = 0;
let statementsOfTheirOwn = 0;

// Plain Bun quotes the source of the expression in what the engine says about a call or a read, and a compiled program has no source.
const withoutQuotedSource = (outcome: string) =>
  outcome
    .replace(/ \(evaluating '.*'\)$/s, "")
    .replace(
      /^(threw TypeError: ).* is not a (function|constructor)\. \(In '.*', '.*' is (.*)\)$/s,
      "$1$3 is not a $2",
    );

type Case = { expression: string; declared: string; unused: string; used: string };
type Run = Awaited<ReturnType<typeof spawned>>;

/** What a run of `main.js` says of the expressions that it was made of: a line for each, in their order, with what each form did. */
function casesOf(run: Run, asked: readonly string[]): Case[] {
  const cases = run.stdout
    .split("\n")
    .filter(line => line !== "")
    .map(line => JSON.parse(line) as Case);
  expect(cases.map(line => [line.expression, typeof line.declared, typeof line.unused, typeof line.used])).toEqual(
    asked.map(expression => [expression, "string", "string", "string"]),
  );
  return cases.map(({ expression, declared, unused, used }) => ({
    expression,
    declared: withoutQuotedSource(declared),
    unused: withoutQuotedSource(unused),
    used: withoutQuotedSource(used),
  }));
}

function casesOfPlainBun(plain: Run, asked: readonly string[]): Case[] {
  expect({ stderr: plain.exitCode === 0 ? "" : plain.stderr, exitCode: plain.exitCode, signal: plain.signal }).toEqual({
    stderr: "",
    exitCode: 0,
    signal: null,
  });
  return casesOf(plain, asked);
}

// No program may count on an error for lack of memory, so it may go with the allocation that nobody uses.
const mayGoUnused = (outcome: string) => outcome === "threw RangeError: Out of memory";

const inPlainBun = (folder: string) => slot(() => spawned([bunExe(), "main.js"], folder, env));

/** What plain Bun and the executable say of the expressions that `main.js` of the folder was made of. The build does not wait for plain Bun. */
async function inBothWays(folder: string, asked: readonly string[], startedInPlainBun = () => inPlainBun(folder)) {
  using outside = tempDir("aot-unused-calls-executable", {});
  const executable = join(String(outside), isWindows ? "app.exe" : "app");
  // Nothing that may throw stands between the start of a run and the wait for both. Where one fails the other ends first: no folder goes
  // from under a process that still runs.
  const runs = [
    startedInPlainBun(),
    slot(async () => {
      built(await spawned([bunExe(), ...compileCommand, "main.js", "--outfile", executable], folder, env));
      return spawned([executable], folder, env);
    }),
  ] as const;
  const [plain, compiled] = await Promise.all(runs).finally(() => Promise.allSettled(runs));
  const expected = casesOfPlainBun(plain, asked);
  // A module that is deprecated says so when it is loaded, in both, with the number of the process and the name of the executable.
  const withoutProcess = (stderr: string) =>
    stderr.replace(/^\(node:\d+\)/gm, "(node)").replace(/^\(Use `\S+ /gm, "(Use `bun ");
  expect({ stderr: withoutProcess(compiled.stderr), exitCode: compiled.exitCode, signal: compiled.signal }).toEqual({
    stderr: withoutProcess(plain.stderr),
    exitCode: 0,
    signal: null,
  });
  return { expected, actual: casesOf(compiled, asked) };
}

// Plain Bun is the measure. It runs a program once, for the test of the program and for the choice of the modules, in the folder where the
// program is built and its executable starts. So that folder goes when the file is through, and an executable is written outside it.
type Program = { first: number; expressions: string[]; folder?: ReturnType<typeof tempDir>; plain?: Promise<Run> };
const programs: Program[] = [];
for (let start = 0; start < expressions.length; start += expressionsPerProgram)
  programs.push({ first: start + 1, expressions: expressions.slice(start, start + expressionsPerProgram) });
afterAll(async () => {
  // A run that no test has waited for ends first.
  await Promise.allSettled(programs.map(({ plain }) => plain));
  for (const { folder } of programs) folder?.[Symbol.dispose]();
});

const folderOf = (program: Program) =>
  String((program.folder ??= tempDir("aot-unused-calls", { "main.js": programOf(modules, program.expressions) })));
const plainRunOf = (program: Program) => (program.plain ??= inPlainBun(folderOf(program)));

async function findDifferences(program: Program) {
  const { expected, actual } = await inBothWays(folderOf(program), program.expressions, () => plainRunOf(program));
  // What plain Bun does with the result kept is the measure: its transpiler takes some unused expressions away by a list of its own.
  const inForms = ({ declared, unused, used }: Case) =>
    declared === used && unused === used ? used : `declared and not read ${declared}, unused ${unused}, used ${used}`;
  plainBunDiffersFromItself += expected.filter(
    ({ declared, unused, used }) => declared !== used || unused !== used,
  ).length;
  return expected.flatMap((plainCase, index) => {
    const { declared, unused, used } = actual[index];
    const isUsedAlike = used === plainCase.used;
    const isSame = (outcome: string) => outcome === used || (outcome === "returned" && mayGoUnused(plainCase.used));
    if (isUsedAlike && isSame(declared) && isSame(unused)) return [];
    return [`${plainCase.expression}\n  plain Bun: ${inForms(plainCase)}\n  compiled: ${inForms(actual[index])}`];
  });
}

// A module costs ten times what an expression costs, so of the expressions that end alike the first stands for all.
async function findDifferencesAlone() {
  const runs = await Promise.all(programs.map(program => plainRunOf(program)));
  const endings = new Set<string>();
  const throwing = programs
    .flatMap((program, index) => casesOfPlainBun(runs[index], program.expressions))
    .filter(({ used }) => used !== "returned" && !mayGoUnused(used) && !endings.has(used) && endings.add(used));
  statementsOfTheirOwn = throwing.length;
  const asked = throwing.map(({ expression }) => expression);
  // Some of all the expressions throw in plain Bun. A run that finds none has not learned what an expression does.
  if (expressions.length === everyExpression.length) expect(asked.length).toBeGreaterThan(0);
  if (asked.length === 0) return [];
  using dir = tempDir("aot-unused-calls-modules", modulesOf(modules, asked));
  // The test of its program holds the executable to what the expression does with its result kept. The way through the loader of modules
  // may word an error anew, so what arrives in plain Bun counts as well, where its transpiler has not taken the statement away.
  const { expected: plainAlone, actual: alone } = await inBothWays(String(dir), asked);
  return throwing.flatMap(({ expression, used }, index) => {
    const { declared, unused } = alone[index];
    const isAlike = (outcome: string, plain: string) => outcome === used || (plain !== "returned" && outcome === plain);
    if (isAlike(declared, plainAlone[index].declared) && isAlike(unused, plainAlone[index].unused)) return [];
    return [
      `${expression}\n  in a function: ${used}\n  alone in a module, plain Bun: declared and not read ${plainAlone[index].declared}, bare ${plainAlone[index].unused}` +
        `\n  alone in a module, compiled: declared and not read ${declared}, bare ${unused}`,
    ];
  });
}

describe.concurrent("an unused result takes no error away:", () => {
  for (const program of programs) {
    test(
      `expressions ${program.first} to ${program.first + program.expressions.length - 1}`,
      async () => expect(await findDifferences(program)).toEqual([]),
      600_000,
    );
  }
  test(
    "the first expression of each error, alone in a module",
    async () => expect(await findDifferencesAlone()).toEqual([]),
    600_000,
  );
});

test("what is covered and what is left out", () => {
  const cases = everyExpression.length;
  const byRule = Object.groupBy(leftOut, ({ rule }) => rule);
  console.log(
    `${overloads} overloads that may be removed, ${cases} expressions, each in three forms, in plain Bun and compiled`,
  );
  console.log(`plain Bun does something else with the result unused than with it used: ${plainBunDiffersFromItself}`);
  console.log(`expressions that throw, each also alone in two modules: ${statementsOfTheirOwn}`);
  for (const [rule, entries] of Object.entries(byRule)) console.log(`left out, ${rule}: ${entries!.length}`);
  expect(overloads).toBeGreaterThan(150);
  expect(cases).toBeGreaterThan(2_500);
});
