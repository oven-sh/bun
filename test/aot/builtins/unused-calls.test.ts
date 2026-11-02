// A row of the table of built-ins that forgets a throw is wrong code: the compiler takes a call away with its unused result, and the error with
// it. Whether native code throws where a row says it does not is asked of every row without a compiler: differential.test.ts. Here the compiler
// is asked what it makes of the rows. Of the rows that make the same claims the first stands for all: its call, construction or read is made
// with operands that are missing, of the wrong kind or extreme, with another receiver, with and without `new`: in a declaration that nothing
// reads, in a statement, and with its result kept, in plain Bun and compiled. All must do the same: return, or throw an error of the same name,
// message and code. Of the expressions that end in the same error the first is then compiled once more as the one statement of a module of its
// own, where a whole statement may be left out. unused-calls/cases.ts makes the programs from the table in this build of Bun.
//
//   AOT_UNUSED_CALLS=<r>  only the expressions that match the regular expression ("^Object", "MODULE_")
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
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
// A module costs ten times what an expression costs, so of the expressions that end alike the first stands for all.
const endings = new Set<string>();
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

const parse = (stdout: string): Case[] =>
  stdout
    .split("\n")
    .filter(line => line !== "")
    .map(line => JSON.parse(line) as Case)
    .map(({ expression, declared, unused, used }) => ({
      expression,
      declared: withoutQuotedSource(declared),
      unused: withoutQuotedSource(unused),
      used: withoutQuotedSource(used),
    }));

// No program may count on an error for lack of memory, so it may go with the allocation that nobody uses.
const mayGoUnused = (outcome: string) => outcome === "threw RangeError: Out of memory";

async function findDifferences(expressions: readonly string[]) {
  using dir = tempDir("aot-unused-calls", { "main.js": programOf(modules, expressions) });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const plain = await spawned([bunExe(), "main.js"], folder, env);
  expect({ exitCode: plain.exitCode, signal: plain.signal }).toEqual({ exitCode: 0, signal: null });
  built(await spawned([bunExe(), ...compileCommand, "main.js", "--outfile", executable], folder, env));
  const compiled = await spawned([executable], folder, env);
  // A module that is deprecated says so when it is loaded, in both, with the number of the process and the name of the executable.
  const withoutProcess = (stderr: string) =>
    stderr.replace(/^\(node:\d+\)/gm, "(node)").replace(/^\(Use `\S+ /gm, "(Use `bun ");
  expect({ stderr: withoutProcess(compiled.stderr), exitCode: compiled.exitCode, signal: compiled.signal }).toEqual({
    stderr: withoutProcess(plain.stderr),
    exitCode: 0,
    signal: null,
  });

  const expected = parse(plain.stdout);
  const actual = parse(compiled.stdout);
  expect(actual.map(({ expression }) => expression)).toEqual(expected.map(({ expression }) => expression));
  expect(expected.length).toBe(expressions.length);
  // What plain Bun does with the result kept is the measure: its transpiler takes some unused expressions away by a list of its own.
  const inForms = ({ declared, unused, used }: Case) =>
    declared === used && unused === used ? used : `declared and not read ${declared}, unused ${unused}, used ${used}`;
  plainBunDiffersFromItself += expected.filter(
    ({ declared, unused, used }) => declared !== used || unused !== used,
  ).length;
  const differences = expected.flatMap((plainCase, index) => {
    const { declared, unused, used } = actual[index];
    const isUsedAlike = used === plainCase.used;
    const isSame = (outcome: string) => outcome === used || (outcome === "returned" && mayGoUnused(plainCase.used));
    if (isUsedAlike && isSame(declared) && isSame(unused)) return [];
    return [`${plainCase.expression}\n  plain Bun: ${inForms(plainCase)}\n  compiled: ${inForms(actual[index])}`];
  });

  const throwing = actual.filter(
    ({ used }) => used !== "returned" && !mayGoUnused(used) && !endings.has(used) && endings.add(used),
  );
  if (throwing.length === 0) return differences;
  statementsOfTheirOwn += throwing.length;
  using folderOfModules = tempDir(
    "aot-unused-calls-modules",
    modulesOf(
      modules,
      throwing.map(({ expression }) => expression),
    ),
  );
  const modulesFolder = String(folderOfModules);
  const loader = join(modulesFolder, isWindows ? "app.exe" : "app");
  built(await spawned([bunExe(), ...compileCommand, "main.js", "--outfile", loader], modulesFolder, env));
  const loaded = await spawned([loader], modulesFolder, env);
  expect({ exitCode: loaded.exitCode, signal: loaded.signal }).toEqual({ exitCode: 0, signal: null });
  const alone = parse(loaded.stdout);
  expect(alone.map(({ expression }) => expression)).toEqual(throwing.map(({ expression }) => expression));
  // What the expression does with its result kept was held against plain Bun above. The way through the loader of modules may word an error
  // anew, so what arrives in plain Bun counts as well, where its transpiler has not taken the statement away.
  const plainLoaded = await spawned([bunExe(), "main.js"], modulesFolder, env);
  expect({ exitCode: plainLoaded.exitCode, signal: plainLoaded.signal }).toEqual({ exitCode: 0, signal: null });
  const plainAlone = parse(plainLoaded.stdout);
  return differences.concat(
    throwing.flatMap(({ expression, used }, index) => {
      const { declared, unused } = alone[index];
      const isAlike = (outcome: string, plain: string) =>
        outcome === used || (plain !== "returned" && outcome === plain);
      if (isAlike(declared, plainAlone[index].declared) && isAlike(unused, plainAlone[index].unused)) return [];
      return [
        `${expression}\n  in a function: ${used}\n  alone in a module, plain Bun: declared and not read ${plainAlone[index].declared}, bare ${plainAlone[index].unused}` +
          `\n  alone in a module, compiled: declared and not read ${declared}, bare ${unused}`,
      ];
    }),
  );
}

describe.concurrent("an unused result takes no error away:", () => {
  for (let start = 0; start < expressions.length; start += expressionsPerProgram) {
    const taken = expressions.slice(start, start + expressionsPerProgram);
    test(
      `expressions ${start + 1} to ${start + taken.length}`,
      () => slot(async () => expect(await findDifferences(taken)).toEqual([])),
      600_000,
    );
  }
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
