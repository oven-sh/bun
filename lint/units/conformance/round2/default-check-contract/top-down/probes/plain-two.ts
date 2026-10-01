// The two runs of the test "stderr is read in the plain format ..." side by side, outside the test runner, with the fixture as the command.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
const scratch = process.argv[2];
const home = `${scratch}/test/cli/lint/conformance`;
const { runInstance } = await import(`${home}/runner`);
const { createSpawnCheck } = await import(`${home}/runner/check_bun_lint`);
const { tsgoRules } = await import(`${home}/runner/diagnosticwriter`);
const { getErrorBaseline } = await import(`${home}/runner/error_baseline`);
const { toWriterInput } = await import(`${home}/runner/shape`);
const unit = { unitName: "/.src/a.ts", content: 'const x: number = "s";\n//~ print {file}(1,7): error TS2322: Type \'string\' is not assignable to type \'number\'.\n//~ print   A line of the chain.\n' };
const known = { category: "error", code: 2322, messageText: "Type 'string' is not assignable to type 'number'.", next: [{ messageText: "A line of the chain." }], location: { file: unit.unitName, start: 6, length: 1 }, relatedInformation: [] };
const written = toWriterInput(tsgoRules, [unit], [known]);
const expected = tsgoRules.model.toBytes(getErrorBaseline(tsgoRules, written.files, written.diagnostics, false).text);
const linter = createSpawnCheck({ command: [process.execPath, `${home}/fixtures/lints-fixture.ts`], env: process.env });
const E = { name: "a.ts", status: "run", oracle: { class: "E" } };
const run = async (level?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "dcc1b-plain-"));
  const input = (_i: unknown, root: string | undefined) => {
    if (root !== undefined) { mkdirSync(dirname(root + unit.unitName), { recursive: true }); writeFileSync(root + unit.unitName, unit.content); }
    return { ok: true, input: { currentDirectory: "/.src", rootFiles: [unit.unitName], otherFiles: [], units: [unit], symlinks: [], options: {} } };
  };
  try { return await runInstance(E, linter, { input, oracle: () => expected, directory: join(dir, "instances"), level }); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const [whole, first] = await Promise.all([run(), run("first-section")]);
for (const r of [whole, first]) console.log(JSON.stringify({ outcome: r.outcome, reason: r.reason, headerOnly: r.headerOnly, level: r.level, cause: r.cause }));
