// A row of the table of built-ins that forgets a throw is wrong code: the compiler takes a call away with its unused result, and the error with
// it. So every call, construction and read of an accessor that the table lets go is made here with operands that are missing, of the wrong
// kind or extreme, with another receiver, with and without `new`: in a declaration that nothing reads, in a statement, and with its result
// kept, in plain Bun and compiled. All must do the same: return, or throw an error of the same name, message and code. What throws is then
// compiled once more as the one statement of a module of its own, where a whole statement may be left out.
// unused-calls/cases.ts makes the programs from the table in this build of Bun.
//
//   AOT_UNUSED_CALLS=<r>  only the holders whose name matches the regular expression ("^Object$", "node:util")
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "../harness/flags";
import { built, slot, spawned } from "../run-programs";
import { describe, test } from "../supported";
import type { TableDump } from "./differential/table-description";
import { CaseMaker, modulesOf, programOf } from "./unused-calls/cases";

const env = { ...bunEnv, NO_COLOR: "1" };
const filter = new RegExp(process.env.AOT_UNUSED_CALLS ?? ".");
const expressionsPerProgram = 400;

const dump: TableDump = aotBuiltinEntries();
const { groups, leftOut, overloads } = new CaseMaker(dump).make(dump);
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

// docs/bundler/aot-compatibility.mdx, "When a function of Bun or Node rejects an argument": an executable describes what it got without running
// a trap of a proxy, which it shows as [Object]. Plain Bun asks a revoked proxy, and the error of that takes the place of the rejection.
const isRejectionOfProxy = (plain: string, compiled: string) =>
  plain.startsWith("threw TypeError: Proxy has already been revoked.") &&
  /^threw TypeError: .* Received \[Object\] \[ERR_INVALID_ARG_TYPE\]$/.test(compiled);

// No program may count on an error for lack of memory, so it may go with the allocation that nobody uses.
const mayGoUnused = (outcome: string) => outcome === "threw RangeError: Out of memory";

async function findDifferences(module: string | null, expressions: readonly string[]) {
  using dir = tempDir("aot-unused-calls", { "main.js": programOf(module, expressions) });
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
    const isUsedAlike = used === plainCase.used || isRejectionOfProxy(plainCase.used, used);
    const isSame = (outcome: string) => outcome === used || (outcome === "returned" && mayGoUnused(plainCase.used));
    if (isUsedAlike && isSame(declared) && isSame(unused)) return [];
    return [`${plainCase.expression}\n  plain Bun: ${inForms(plainCase)}\n  compiled: ${inForms(actual[index])}`];
  });

  const throwing = actual.filter(({ used }) => used !== "returned" && !mayGoUnused(used));
  if (throwing.length === 0) return differences;
  statementsOfTheirOwn += throwing.length;
  using modules = tempDir(
    "aot-unused-calls-modules",
    modulesOf(
      module,
      throwing.map(({ expression }) => expression),
    ),
  );
  const modulesFolder = String(modules);
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
  for (const [holder, { module, expressions }] of groups) {
    if (!filter.test(holder)) continue;
    for (let start = 0; start < expressions.length; start += expressionsPerProgram) {
      const part = expressions.slice(start, start + expressionsPerProgram);
      const title = expressions.length > expressionsPerProgram ? `${holder}, from ${start}` : holder;
      test(
        `${title} (${part.length})`,
        () => slot(async () => expect(await findDifferences(module, part)).toEqual([])),
        600_000,
      );
    }
  }
});

test("what is covered and what is left out", () => {
  const cases = [...groups.values()].reduce((sum, { expressions }) => sum + expressions.length, 0);
  const byRule = Object.groupBy(leftOut, ({ rule }) => rule);
  console.log(
    `${overloads} overloads that may be removed, ${cases} expressions, each in three forms, in plain Bun and compiled`,
  );
  console.log(`plain Bun does something else with the result unused than with it used: ${plainBunDiffersFromItself}`);
  console.log(`expressions that throw, each also alone in two modules: ${statementsOfTheirOwn}`);
  for (const [rule, entries] of Object.entries(byRule)) console.log(`left out, ${rule}: ${entries!.length}`);
  expect(overloads).toBeGreaterThan(300);
  expect(cases).toBeGreaterThan(10_000);
});
