// The expectations of describe("sweep.ts") of the glue tree, held here with node:assert: the same starts of the script, one after the other.
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const home = "/tmp/st1b/glue/test/cli/lint/conformance";
const fixtures = join(home, "fixtures");
const runner = await import(`${home}/runner`);
const sweep = async (directory: string, fixture: string, ...args: string[]) => {
  const lists = join(directory, "lists.json");
  writeFileSync(lists, runner.formatExpectations({ level: "baseline", E: [], C: [] }));
  const check = ["--check", join(fixtures, fixture), "--no-files", "--expectations", lists];
  const proc = Bun.spawn({ cmd: [process.execPath, join(home, "sweep.ts"), ...check, ...args], stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
};
const dir = () => mkdtempSync(join(tmpdir(), "st1b-check-"));
const skipped = "skip abstractPropertyNegative(target=es5).ts unsupported target ES5";
const five = ["conformance/types/tuple/emptyTuples", "abstractPropertyNegative.ts", "compiler/2dArrays.ts"];
{
  const ran = await sweep(dir(), "replay-check-fixture.ts", "--each", ...five);
  assert.deepStrictEqual(ran.stdout.split("\n"), ["pass 2dArrays.ts", "pass abstractPropertyNegative(target=es2015).ts", skipped, "pass emptyTuplesTypeAssertion01.ts", "pass emptyTuplesTypeAssertion02.ts", ""]);
  assert(ran.stderr.includes("instances 5: pass 4, skip 1\n"));
  assert.strictEqual(ran.exitCode, 0);
  console.log("ok 1");
}
{
  const names = ["ArrowFunctionExpression1.ts", "ClassDeclaration10.ts", "abstractPropertyNegative(target=es5).ts"];
  const ran = await sweep(dir(), "wrong-check-fixture.ts", "--each", "castingTuple.ts", "2dArrays.ts", ...names);
  const casting = `"castingTuple.ts(3,24): error TS7008: Member 'c' implicitly has an 'any' type."`;
  assert.deepStrictEqual(ran.stdout.split("\n"), [
    "fail 2dArrays.ts 1 diagnostics where the oracle has none, the first is TS1: Made up.",
    'fail ArrowFunctionExpression1.ts line 1: - "ArrowFunctionExpression1.ts(1,10): error TS2369: A parameter property is only allowed in a constructor implementation."',
    "pass ClassDeclaration10.ts",
    skipped,
    `fail castingTuple.ts line 1: - ${casting} + "castingTuple.ts(3,24): error TS7008: Changed."`,
    "",
  ]);
  assert(ran.stderr.includes("instances 5: pass 1, fail 3, skip 1\n"));
  assert.strictEqual(ran.exitCode, 1);
  console.log("ok 2");
}
{
  const d = dir();
  const resume = ["--resume", join(d, "outcomes.jsonl")];
  const half = await sweep(d, "empty-check-fixture.ts", "--each", "--shard", "1/2", ...resume, ...five);
  assert.deepStrictEqual(half.stdout.split("\n"), [
    "pass 2dArrays.ts",
    skipped,
    `fail emptyTuplesTypeAssertion02.ts line 1: - "emptyTuplesTypeAssertion02.ts(2,11): error TS2493: Tuple type '[]' of length '0' has no element at index '0'."`,
    "",
  ]);
  assert.strictEqual(half.exitCode, 1);
  const report = join(d, "report.json");
  const whole = await sweep(d, "empty-check-fixture.ts", ...resume, "--report", report, ...five);
  assert(whole.stdout.includes(": 2 outcomes kept, 2 instances to run\n"));
  assert(whole.stdout.includes([
    "                                       E run  E fail  C run  C pass",
    "  compiler                                 1       1      1       1",
    "  conformance/types/tuple/emptyTuples      2       2      0       0",
    "  total                                    3       3      1       1",
    "",
  ].join("\n")));
  assert(whole.stdout.includes("          E run  E fail\n  TS2493      2       2\n"));
  const { totals, directoryOutcomes, codes, resumed } = JSON.parse(readFileSync(report, "utf8"));
  assert.deepStrictEqual({ outcomes: totals.outcomes, directoryOutcomes, TS2493: codes.TS2493, kept: resumed.kept }, {
    outcomes: { E: { fail: 3 }, C: { pass: 1 } },
    directoryOutcomes: { "compiler": { E: { fail: 1 }, C: { pass: 1 } }, "conformance/types/tuple/emptyTuples": { E: { fail: 2 }, C: {} } },
    TS2493: { instances: 2, pass: 0, diagnostics: 2, outcomes: { fail: 2 } },
    kept: 2,
  });
  assert.strictEqual(whole.exitCode, 0);
  console.log("ok 3");
}
{
  const ran = await sweep(dir(), "empty-check-fixture.ts", "--each", "--update");
  assert.strictEqual(ran.stdout, "");
  assert(ran.stderr.includes("sweep: --each holds no instance against a list: --update cannot go with it\n\nusage: "));
  assert.strictEqual(ran.exitCode, 2);
  console.log("ok 4");
}
