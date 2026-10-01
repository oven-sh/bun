// The two corpus instances of the test "the binary under test: a case of the corpus ..." through the default check, outside the test runner.
// usage: bun corpus-case.ts <scratch clone> <binary>
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [scratch, bin] = process.argv.slice(2);
const runner = await import(`${scratch}/test/cli/lint/conformance/runner`);
const { createSpawnCheck, probe } = await import(`${scratch}/test/cli/lint/conformance/runner/check_bun_lint`);
const corpus = runner.openCorpus(`${scratch}/test/cli/lint/conformance/corpus`);
const options = { command: [bin], env: process.env };
const probed = await probe(options);
console.log("probe", JSON.stringify(probed));
const check = createSpawnCheck({ ...options, probed });
const dir = mkdtempSync(join(tmpdir(), "dcc1b-case-"));
for (const [path, name] of [["compiler/2dArrays.ts", "2dArrays.ts"], ["compiler/ArrowFunctionExpression1.ts", "ArrowFunctionExpression1.ts"]]) {
  const instance = corpus.enumerateCase(path).find((i: any) => i.name === name);
  for (const level of ["baseline", "first-section"]) {
    const r = await runner.runInstance(instance, check, { input: (i: any, root: any) => corpus.input(i, root), oracle: (i: any) => corpus.oracle(i), directory: dir, level });
    const { outcome, cause, reason, named, rules, death, level: at } = r;
    console.log(name, JSON.stringify({ asked: level, outcome, cause, reason, named, rules, death, level: at }));
  }
}
rmSync(dir, { recursive: true, force: true });
