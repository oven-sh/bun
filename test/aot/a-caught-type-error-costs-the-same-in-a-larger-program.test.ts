// A TypeError that is thrown and caught costs the same however large the program is.
//
// Its message quotes the read or the call that failed. An executable takes the quote from the text it keeps for `fn.toString()`, and
// a test run takes it from the file where there is no such text. Whatever looks through a table, a text or a file at each throw makes
// the throw slower as that grows. So the same loop runs in a small program and in one that has grown in one way:
//
//   many functions    the table of the texts has an entry for each function that can be a value
//   long functions    the line that fails has 2,000 lines of its function in front of it
//   two modules       in a test run, functions of two long files take turns
//
// Two functions take turns to throw, so remembering the last answer does not help. The program measures itself with
// process.cpuUsage(), around the loop alone, so the test needs no counters and runs on every platform.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const kinds = [
  { name: "a member of undefined", fails: "o.inner.value", quoted: "(evaluating 'o.inner.value')" },
  {
    name: "a call of what is not a function",
    fails: "o.missing(1)",
    quoted: "(In 'o.missing(1)', 'o.missing' is undefined)",
  },
  {
    name: "a construction of what is not a constructor",
    fails: "new o.Missing(1)",
    quoted: "(evaluating 'new o.Missing(1)')",
  },
];

// Comments are part of the text and take no time to compile.
const lines = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `// Line ${index}, which is here to be as long as a line usually is.`,
  ).join("\n");
const thrower = (name: string, fails: string, linesInFront: number) =>
  `function ${name}(o: any) {\n${lines(linesInFront)}\nconst result = ${fails}; return result; }`;

// The functions that throw come last: that is where a search from the front takes longest.
const program = (functions: number, linesInFront: number) => `
  ${Array.from({ length: functions }, (_, index) => `function f${index}() { return ${index}; }`).join("\n")}
  const others = [${Array.from({ length: functions }, (_, index) => `f${index}`).join(", ")}];
  ${kinds.map((kind, index) => thrower(`first${index}`, kind.fails, linesInFront) + "\n" + thrower(`second${index}`, kind.fails, linesInFront)).join("\n")}
  const pairs = [${kinds.map((_, index) => `[first${index}, second${index}]`).join(", ")}];
  const [first, second] = pairs[Number(process.argv[2])];
  let message = "";
  const start = process.cpuUsage();
  for (let i = 0; i < 20_000; i++) {
    try {
      (i & 1 ? first : second)({});
    } catch (error) {
      message = (error as Error).message;
    }
  }
  const spent = process.cpuUsage(start);
  console.log(JSON.stringify({ message, others: others[others.length - 1]() + 1, milliseconds: (spent.user + spent.system) / 1000 }));`;

const programs = {
  "small": { functions: 600, linesInFront: 0 },
  "many-functions": { functions: 30_000, linesInFront: 0 },
  "long-functions": { functions: 600, linesInFront: 2_000 },
};
type Program = keyof typeof programs;

// Nothing but a call reaches `fails`, so a compiled test run has its text nowhere but in the file.
const moduleOfTestRun = `${lines(5_000)}
  function fails(o: any) { const result = o.inner.value; return result; }
  export function run(o: any) { const result = fails(o); return result; }`;
const testRun = `
  import { test } from "bun:test";
  import { run as first } from "./first-module";
  import { run as second } from "./second-module";
  test("turns", () => {
    const measured: Record<string, unknown> = {};
    for (const modules of ["one", "two"]) {
      const start = process.cpuUsage();
      for (let i = 0; i < 3_000; i++) {
        try {
          (modules === "two" && i & 1 ? second : first)({});
        } catch (error) {
          measured.message = (error as Error).message;
        }
      }
      const spent = process.cpuUsage(start);
      measured[modules] = (spent.user + spent.system) / 1000;
    }
    console.log("MEASURED " + JSON.stringify(measured));
  });`;

const dir = tempDir("aot-caught-type-errors", {
  ...Object.fromEntries(
    Object.entries(programs).map(([name, { functions, linesInFront }]) => [
      `${name}.ts`,
      program(functions, linesInFront),
    ]),
  ),
  "first-module.ts": moduleOfTestRun,
  "second-module.ts": moduleOfTestRun,
  "turns.test.ts": testRun,
});
afterAll(() => dir[Symbol.dispose]());
const folder = String(dir);
const pathOf = (name: Program) => join(folder, isWindows ? `${name}.exe` : name);
const whenBuilt: Partial<Record<Program, Promise<void>>> = {};
const build = (name: Program) =>
  (whenBuilt[name] ??= spawned(
    [bunExe(), "build", "--compile", "--aot", `./${name}.ts`, "--outfile", pathOf(name)],
    folder,
    bunEnv,
  ).then(built));

describe.concurrent("a caught TypeError costs in a large program what it costs in a small one", () => {
  for (const grown of ["many-functions", "long-functions"] as const) {
    for (const [index, kind] of kinds.entries()) {
      test(`${grown}: ${kind.name}`, async () => {
        await Promise.all([build("small"), build(grown)]);
        const measure = async (name: Program) => {
          let least = Infinity;
          for (let run = 0; run < 2; run++) {
            const ran = await spawned([pathOf(name), String(index)], folder, bunEnv, 200_000);
            expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
            const { message, others, milliseconds } = JSON.parse(ran.stdout);
            expect(message).toEndWith(kind.quoted);
            expect(others).toBe(programs[name].functions);
            least = Math.min(least, milliseconds);
          }
          return least;
        };
        const small = await measure("small");
        const large = await measure(grown);
        console.error(
          `THROWS ${kind.name}: ${small.toFixed(1)} ms in the small program | ${large.toFixed(1)} ms with ${grown}`,
        );
        expect(large).toBeLessThan(3 * small + 60);
      }, 480_000);
    }
  }

  test("two modules of a test run", async () => {
    const ran = await spawned([bunExe(), "test", "--aot", "./turns.test.ts"], folder, bunEnv, 200_000);
    const line = ran.stdout.split("\n").find(line => line.startsWith("MEASURED "));
    expect({ line: line !== undefined, exitCode: ran.exitCode, stderr: line === undefined ? ran.stderr : "" }).toEqual({
      line: true,
      exitCode: 0,
      stderr: "",
    });
    const { message, one, two } = JSON.parse(line!.slice("MEASURED ".length));
    expect(message).toEndWith("(evaluating 'o.inner.value')");
    console.error(
      `THROWS in a test run: ${one.toFixed(1)} ms in one module | ${two.toFixed(1)} ms in two that take turns`,
    );
    expect(two).toBeLessThan(3 * one + 60);
  }, 480_000);
});
