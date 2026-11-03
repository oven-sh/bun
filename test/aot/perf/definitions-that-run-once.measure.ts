// What one statement at the top of a CommonJS file costs that gives the file's exports, a function or a prototype a name: it runs once, so nothing that was remembered helps it.
// A hundred files with sixteen such statements each are held against a hundred with eight: instructions a statement = the difference / 800. Start-up and the loading of the files cancel out.
import { expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { describe, test } from "../supported";

const numberOfFiles = 100;
const rows: [what: string, statement: (file: number, index: number) => string, head: string, allowance: number][] = [
  [
    "a getter defined on the exports",
    (file, index) =>
      `Object.defineProperty(exports, "n${file}x${index}", { enumerable: true, get: function () { return ${index}; } });`,
    "",
    1650,
  ],
  [
    "a method stored on the prototype of a function",
    (file, index) => `F.prototype.n${file}x${index} = function () { return ${index}; };`,
    "function F() {}\nexports.F = F;",
    1300,
  ],
  [
    "a function stored on a function",
    (file, index) => `F.n${file}x${index} = function () { return ${index}; };`,
    "function F() {}\nexports.F = F;",
    1400,
  ],
];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !isLinux || process.arch !== "x64" || isMusl
      ? "the allowances are those of Linux x64 with glibc"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/definitions-that-run-once.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/definitions-that-run-once", () => {
  const env = { ...bunEnv, ...withSteadyCollections };
  for (const [what, statement, head, allowance] of rows) {
    test.concurrent(
      `${what}: at most ${allowance} instructions`,
      async () => {
        const folder = String(tempDir("aot-definitions-that-run-once", {}));
        const counts: (number | undefined)[] = [];
        for (const statements of [8, 16]) {
          const root = join(folder, String(statements));
          mkdirSync(root);
          for (let file = 0; file < numberOfFiles; file++)
            writeFileSync(
              join(root, `m${file}.js`),
              `${head}\n${Array.from({ length: statements }, (_, index) => statement(file, index)).join("\n")}\n`,
            );
          writeFileSync(
            join(root, "main.js"),
            `let loaded = 0;\n${Array.from({ length: numberOfFiles }, (_, file) => `loaded += typeof require("./m${file}.js") === "object" ? 1 : 0;`).join("\n")}\nconsole.log(loaded);\n`,
          );
          const executable = join(root, "main");
          built(
            await spawned(
              [
                bunExe(),
                "build",
                "--compile",
                "--aot",
                ...withoutDebugInformation(),
                join(root, "main.js"),
                "--outfile",
                executable,
              ],
              root,
              bunEnv,
            ),
          );
          const run = await measureCommand(root, [executable], 300_000, env);
          expect(run.stdout).toBe(`${numberOfFiles}\n`);
          counts.push(run.instructions);
        }
        const [few, many] = counts;
        if (few === undefined || many === undefined)
          return void console.error(`SKIPPED: ${what}: instructions cannot be counted here`);
        const measured = Math.round((many - few) / (numberOfFiles * 8));
        console.error(`DEFINITIONS THAT RUN ONCE ${what}\t${measured}\t| at most\t${allowance}`);
        expect({ what, measured, isWithinAllowance: measured <= allowance }).toEqual({
          what,
          measured,
          isWithinAllowance: true,
        });
      },
      900_000,
    );
  }
});
