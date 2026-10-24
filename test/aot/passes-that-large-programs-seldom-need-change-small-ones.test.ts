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
  "a record literal inside a record literal": {
    pass: "FlattenInnerObjects",
    statistic: "FieldsHoldingFlattenedObjects",
    source: `function make(i: number) { return { b: i, c: { d: i + 1, e: i + 2 } }; }
const all: ReturnType<typeof make>[] = [];
for (let i = 0; i < 1000; i++) all.push(make(i));
let total = 0;
for (const o of all) total += o.b + o.c.d + o.c.e;
console.log(total);
`,
  },
  "two callers that read different members of one result": {
    pass: "SplitFreshResults",
    statistic: "ResultClonesCreated",
    source: `function parts(a: number, b: number) {
  const first = Math.sqrt(a * a + b * b) + Math.sin(a) * Math.cos(b) + Math.atan2(a, b) + Math.exp(a / 100) + Math.log(b + 2) + Math.cbrt(a + b);
  const second = Math.hypot(a, b, 3) + Math.tan(a / 7) * Math.sinh(b / 50) + Math.pow(a, 1.5) + Math.log2(a + 3) + Math.log10(b + 4) + Math.tanh(a - b);
  return { first, second };
}
function one(a: number, b: number): number { let s = 0; for (let i = 0; i < 3; i++) s += parts(a + i, b).first; return s; }
function two(a: number, b: number): number { let s = 0; for (let i = 0; i < 3; i++) s += parts(a, b + i).second; return s; }
let total = 0;
for (let i = 0; i < 3000; i++) total += one(i, i + 1) + two(i + 2, i);
console.log(total.toFixed(3));
`,
  },
  // TODO: an inner object that is sometimes held stays flattened until then only under a switch for tests.
  "a record literal inside a record literal that is held now and then": {
    pass: "FlattenInnerObjects",
    statistic: "FieldsDeferringFlattenedObjects",
    todo: true,
    source: `function make(i: number) { return { b: i, c: { d: i + 1, e: i + 2 } }; }
const all: ReturnType<typeof make>[] = [];
const held: { d: number; e: number }[] = [];
for (let i = 0; i < 1000; i++) all.push(make(i));
let total = 0;
for (const o of all) { total += o.b + o.c.d + o.c.e; if (o.b % 500 === 0) held.push(o.c); }
console.log(total, held.length, held[1].e);
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
