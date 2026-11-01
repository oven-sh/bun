// Two programs that use bun:sql the same way. The second also binds a one-line function of its own and stores it where nobody reads it.
// That must not change how the library is compiled.
//
// It did: how often code runs was estimated again, once the bodies had been simplified, only in a program where a function was split
// behind its entry checks or one file imports another. The first program has neither, so it was optimized by the estimate made before,
// which took functions of bun:sql that nothing calls for warm and some that the query runs for cold.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport, type BuildReport, type FunctionRecord } from "./harness/build-report";
import { compileCommand, withReport } from "./harness/flags";
import { test } from "./supported";

const program = (ownFunction: string, stored: string) => `import { SQL } from "bun";
const box = JSON.parse(process.argv[2] ?? "{}");
const sql = new SQL("sqlite://:memory:");
${ownFunction}
box.mine = [${stored}];
box.sql = sql;
console.log(JSON.stringify(await sql\`select 1 as x\`), box.other);
new Function(process.argv[3] ?? "")();
`;

const files = {
  "without.ts": program("", ""),
  "with.ts": program("function addOne(this: any, a: number) { return a + 1; }", "addOne.bind(null)"),
};

async function build(dir: string, name: string): Promise<{ report: BuildReport; stdout: string }> {
  const report = join(dir, `${name}.json`);
  await using build = Bun.spawn({
    cmd: [bunExe(), ...compileCommand, ...withReport(report, "functions"), `./${name}.ts`, "--outfile", name],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
  await using run = Bun.spawn({ cmd: [join(dir, name)], cwd: dir, env: bunEnv, stdout: "pipe", stderr: "inherit" });
  const [stdout, runExitCode] = await Promise.all([run.stdout.text(), run.exited]);
  expect(runExitCode).toBe(0);
  return { report: readBuildReport(report), stdout };
}

const place = (record: FunctionRecord) =>
  `${record.role} ${record.file}:${record.line}:${record.column} ${record.name}`;
const hasFastAccess = ({ accesses }: FunctionRecord) => accesses.tested + accesses.testedSlotOnly + accesses.free > 0;
const estimates = (report: BuildReport) => report.passes.find(pass => pass.name === "EstimateHeat")!.runs;

function libraryFunctionsWithFastAccesses(report: BuildReport): string[] {
  return report
    .functions!.filter(record => record.role === "Library" && hasFastAccess(record))
    .map(place)
    .sort();
}

test("a function bound and stored away does not change which library functions are compiled as code that runs", async () => {
  using dir = tempDir("aot-one-more-function", files);
  const [without, withFunction] = await Promise.all([build(String(dir), "without"), build(String(dir), "with")]);

  expect(without.stdout).toBe('[{"x":1}] undefined\n');
  expect(withFunction.stdout).toBe(without.stdout);
  expect(estimates(withFunction.report)).toBe(estimates(without.report));
  expect(libraryFunctionsWithFastAccesses(withFunction.report)).toEqual(
    libraryFunctionsWithFastAccesses(without.report),
  );
});
