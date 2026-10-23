// A field of function type holds a closure of one of the functions that the program converts into the type. Where one object
// literal stands behind an interface that is one function, so typed code calls it directly: nothing tests which closure the
// field holds.
//
// A store through `any` is no conversion into the type. The store finds that the value does not fit the field, the property
// leaves its slot, and typed code takes the generic path from there on. So a stranger costs type tests where the field is
// called, and the program still prints what plain Bun prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { countOperations, readBuildReport } from "./harness/build-report";
import { compileCommand, runtimeEnvironment, withReport } from "./harness/flags";
import { isDeclared } from "./harness/registry";
import { built, slot, spawned, told, withoutCoreDump } from "./run-programs";
import { describe, test } from "./supported";

const members = {
  "a method": {
    declared: "read(position: number): number;",
    defined: `read(position) {
    return position * 2;
  },`,
  },
  "a property of function type": {
    declared: "read: (position: number) => number;",
    defined: "read: position => position * 2,",
  },
};
type Member = (typeof members)[keyof typeof members];

const call = "sum += reader.read(position);";

const typedCode = ({ declared, defined }: Member) => `interface Reader {
  ${declared}
}
const doubling: Reader = {
  ${defined}
};
function total(reader: Reader, rounds: number): number {
  let sum = 0;
  for (let position = 0; position < rounds; position++) {
    ${call}
  }
  return sum;
}
function show(): void {
  try {
    console.log(total(doubling, 1000));
  } catch (error) {
    console.log(error instanceof TypeError ? "TypeError" : "another error");
  }
}
`;

const undisturbed = `show();
show();
`;

const disturbed = `function negate(position: number): number {
  return -position;
}
const untyped = doubling as any;
const stored = process.argv[2];
show();
if (stored === "its own function") untyped.read = doubling.read;
else if (stored === "function") untyped.read = negate;
else if (stored === "built-in function") untyped.read = Math.abs;
else if (stored === "bound function") untyped.read = negate.bind(null, 7);
else if (stored === "text") untyped.read = "text";
else if (stored === "nothing") delete untyped.read;
else if (stored === "accessor") Object.defineProperty(untyped, "read", { get: () => negate });
show();
`;
const storedValues = [
  "its own function",
  "function",
  "built-in function",
  "bound function",
  "text",
  "nothing",
  "accessor",
];

async function compile(folder: string, name: string) {
  const executable = join(folder, name + (isWindows ? ".exe" : ""));
  const reportPath = join(folder, name + ".json");
  const flags = ["--explain=statistics", ...withReport(reportPath, "sites")];
  const command = [bunExe(), ...compileCommand, ...flags, name + ".ts", "--outfile", executable];
  const build = await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" });
  built(build);
  const lines = build.stderr.matchAll(/^(\w+) (\d+)$/gm);
  const statistics = new Map(Array.from(lines, ([, statistic, value]) => [statistic, Number(value)] as const));
  return { file: name + ".ts", executable, statistics, report: readBuildReport(reportPath) };
}
type Compiled = Awaited<ReturnType<typeof compile>>;

async function expectOutputOfPlainBun(folder: string, { file, executable }: Compiled, stored: string[]) {
  const plain = await spawned([bunExe(), "run", file, ...stored], folder, bunEnv);
  expect({ stored, signal: plain.signal, exitCode: plain.exitCode }).toEqual({ stored, signal: null, exitCode: 0 });
  const environment = { ...bunEnv, [runtimeEnvironment.forbidsInterpreter]: "1" };
  const compiled = await spawned(withoutCoreDump([executable, ...stored]), folder, environment);
  expect({ stored, signal: compiled.signal, ...told(compiled) }).toEqual({ stored, signal: null, ...told(plain) });
}

const functionsOf = ({ file, report }: Compiled) => report.functions!.filter(record => record.file === file);
const typeTestsAt = ({ file, report }: Compiled, line: number) =>
  report.typeTestSites!.filter(site => site.file === file && site.line === line).length;

describe.concurrent("compile/aot/function fields", () => {
  for (const [title, member] of Object.entries(members)) {
    test(
      `${title} of one literal behind an interface`,
      () =>
        slot(async () => {
          const typed = typedCode(member);
          const lineOfCall = typed.split("\n").findIndex(line => line.includes(call)) + 1;
          using dir = tempDir("aot-function-fields", {
            "undisturbed.ts": typed + undisturbed,
            "disturbed.ts": typed + disturbed,
          });
          const folder = String(dir);

          const before = await compile(folder, "undisturbed");
          expect(before.statistics.get("FunctionTypesWithOneMember")).toBeGreaterThanOrEqual(1);
          expect(isDeclared("operations", "IsClosureOf")).toBe(true);
          expect(functionsOf(before)).not.toEqual([]);
          expect(countOperations(functionsOf(before), ["IsClosureOf"])).toBe(0);
          await expectOutputOfPlainBun(folder, before, []);

          const after = await compile(folder, "disturbed");
          expect(after.report.summary.typeTests).toBeGreaterThan(before.report.summary.typeTests);
          expect(typeTestsAt(after, lineOfCall)).toBeGreaterThan(typeTestsAt(before, lineOfCall));
          await expectOutputOfPlainBun(folder, after, []);
          for (const stored of storedValues) await expectOutputOfPlainBun(folder, after, [stored]);
        }),
      600_000,
    );
  }
});
