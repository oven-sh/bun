// Each function of the row below is found only when the one in front of it has been: it is stored into a field, and one place calls what the field holds.
// That call runs once for each function, so the flow analysis lets it wait until nothing else is due, and in this program nothing else is due at every step.
// Whatever waited beside it was let go with it: the few statements that stand for the whole program among them, and each run of those looks at every built-in
// that the program uses and at all that has escaped. They ran several times for each function of the row. They go on waiting now while anything else can run.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { readBuildReport } from "./harness/build-report";
import { unsupported } from "./harness/compiler";
import { withReport } from "./harness/flags";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";
import { describe, test } from "./listed";

const holders: [string, object][] = [
  ["Math", Math],
  ["Number", Number],
  ["String", String],
  ["Date", Date],
  ["Atomics", Atomics],
  ["Symbol", Symbol],
  ["BigInt", BigInt],
  ["ArrayBuffer", ArrayBuffer],
  ["Intl", Intl],
  ["Object", Object],
  ["Array", Array],
];
const named = holders.flatMap(([holder, object]) =>
  Object.getOwnPropertyNames(object)
    .sort()
    .filter(
      name =>
        /^[A-Za-z][A-Za-z0-9]*$/.test(name) &&
        typeof Object.getOwnPropertyDescriptor(object, name)!.value === "function",
    )
    .map(name => `${holder}.${name}`),
);

const rowOf = (count: number) =>
  [
    `const unknown = JSON.parse(process.argv[2] ?? "{}");`,
    `const state = { next: f0, held: 0 };`,
    ...named
      .slice(0, count)
      .map(
        (member, index) =>
          `function f${index}() { const h = ${member}; if (typeof h === "function") state.held++; state.next = f${index + 1}; if (typeof unknown.m === "function") unknown.m(h); }`,
      ),
    `function f${count}() { state.next = null; }`,
    `while (state.next) state.next();`,
    `console.log(state.held);`,
  ].join("\n") + "\n";
// Each of those statements runs a number of times before it begins to wait, whatever the program.
const short = 25;

describe.skipIf(!!unsupported)(
  "functions that are found one by one, each holding another function of the language",
  () => {
    const { folder, build } = sharedBuilds("functions-that-are-found-one-by-one", {
      "short.js": rowOf(short),
      "long.js": rowOf(named.length),
    });

    test("a function more in the row costs under half a run of the statements for the whole program", async () => {
      expect(named.length).toBeGreaterThan(90);
      const runsFor = async (file: string) => {
        const report = join(folder, `${file}.json`);
        const built = await build(file, "--aot", ...withReport(report, "summary"));
        const printedBy = async (cmd: string[]) => {
          const { stdout, exitCode } = await run(cmd, folder, bunEnv);
          return { stdout, exitCode };
        };
        expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), file]));
        return readBuildReport(report).statistics.FlowRunsForWholeProgram;
      };
      expect((await runsFor("long.js")) - (await runsFor("short.js"))).toBeLessThan((named.length - short) / 2);
    });
  },
);
