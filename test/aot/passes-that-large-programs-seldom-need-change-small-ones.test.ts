// Some passes find nothing to do in a server or in the TypeScript compiler, so only programs written for them say whether
// they are still connected. Each program here holds the form that one pass is for. The build has to say that the pass changed
// something, by the pass's own statistic and by the count of its changes, and the executable prints what plain Bun prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { compileCommand, withReport } from "./harness/flags";
import { built, slot, spawned, told } from "./run-programs";
import { describe, test } from "./supported";

const programs: Record<string, { pass: string; statistic?: string; todo?: boolean; source: string }> = {
  "a loop over the generator that a call beside it makes": {
    pass: "FuseGeneratorLoops",
    statistic: "GeneratorLoopsFused",
    source: `function* range(n: number): Generator<number, void, undefined> { for (let i = 0; i < n; i++) yield i; }
function sum(n: number): number { let s = 0; for (const x of range(n)) s += x; return s; }
let total = 0;
for (let i = 0; i < 2000; i++) total += sum(i & 63);
console.log(total);
`,
  },
  "a counted loop whose result nobody uses": {
    pass: "RemoveDeadCountedLoops",
    source: `function spin(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += i; return n; }
let total = 0;
for (let i = 0; i < 1000; i++) total += spin(i);
console.log(total);
`,
  },
  // The pass edits variables and no function.
  "a variable of a module that one store fills with a constant": {
    pass: "NarrowConstantVariables",
    source: `const text: string = "a" + "b";
const base: number = 3 + 4;
function work(i: number): string { return text + (base + i); }
let last = "";
for (let i = 0; i < 100; i++) last = work(i);
console.log(last);
`,
  },
};

describe.concurrent("compile/aot/passes that large programs seldom need", () => {
  for (const [title, { pass, statistic, todo, source }] of Object.entries(programs)) {
    (todo ? test.todo : test)(title, () =>
      slot(async () => {
        using dir = tempDir("aot-seldom-needed-passes", { "main.ts": source });
        const folder = String(dir);
        const executable = join(folder, "main" + (isWindows ? ".exe" : ""));
        const reportPath = join(folder, "report.json");
        const env = { ...bunEnv, NO_COLOR: "1" };
        built(
          await spawned(
            [bunExe(), ...compileCommand, ...withReport(reportPath, "summary"), "main.ts", "--outfile", executable],
            folder,
            env,
          ),
        );
        const report = readBuildReport(reportPath);
        expect(report.passes.find(record => record.name === pass)?.changes).toBeGreaterThan(0);
        if (statistic) expect(report.statistics[statistic]).toBeGreaterThan(0);
        expect(told(await spawned([executable], folder, env))).toEqual(
          told(await spawned([bunExe(), "main.ts"], folder, env)),
        );
      }),
    );
  }
});
