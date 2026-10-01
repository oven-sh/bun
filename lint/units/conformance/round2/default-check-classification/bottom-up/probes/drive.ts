// The rows of describe("default check") under the new rules, through the prototype: prints what each gives.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Check, Diagnostic, InputFile, InputResult, Instance, RunResult } from "./conformance/runner";
import { runInstance } from "./conformance/runner";
import { createSpawnCheck, probe } from "./conformance/runner/check_bun_lint";
import { tsgoRules } from "./conformance/runner/diagnosticwriter";
import { getErrorBaseline } from "./conformance/runner/error_baseline";
import { toWriterInput } from "./conformance/runner/shape";

const bun = process.argv[2] ?? process.execPath;
const env = process.env;
const fixtures = join(import.meta.dir, "conformance", "fixtures");
const command = (fixture: string) => [bun, join(fixtures, fixture)];
const linter = createSpawnCheck({ command: command("lints-fixture.ts"), env });
const C: Instance = { name: "a.ts", status: "run", oracle: { class: "C" } };
const E: Instance = { name: "a.ts", status: "run", oracle: { class: "E" } };
function baselineOf(units: InputFile[], diagnostics: Diagnostic[]): Uint8Array {
  const written = toWriterInput(tsgoRules, units, diagnostics);
  return tsgoRules.model.toBytes(getErrorBaseline(tsgoRules, written.files, written.diagnostics, false).text);
}
const unitInput =
  (unit: InputFile) =>
  (_instance: Instance, root: string | undefined): InputResult => {
    if (root !== undefined) {
      mkdirSync(dirname(root + unit.unitName), { recursive: true });
      writeFileSync(root + unit.unitName, unit.content);
    }
    return { ok: true, input: { currentDirectory: "/.src", rootFiles: [unit.unitName], otherFiles: [], units: [unit], symlinks: [], options: {} } };
  };
async function run(instance: Instance, check: Check, content: string, more: { oracle?: () => Uint8Array; unitName?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), "dccbu-drive-"));
  try {
    const input = unitInput({ unitName: more.unitName ?? "/.src/a.ts", content });
    return await runInstance(instance, check, { input, oracle: more.oracle ?? (() => new Uint8Array()), directory: join(dir, "instances"), timeoutMs: more.timeoutMs });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const show = (label: string, r: RunResult) => {
  const { instance, actual, diff, ...rest } = r;
  console.log(`${label}\n    ${JSON.stringify(rest)}`);
};

for (const fixture of ["lints-fixture.ts", "runs-fixture.ts", "silent-fixture.ts", "crashes-fixture.ts"]) {
  const dir = mkdtempSync(join(tmpdir(), "dccbu-probe-"));
  console.log(`probe ${fixture}: ${JSON.stringify(await probe({ command: command(fixture), env, probeDirectory: dir }))}`);
  rmSync(dir, { recursive: true, force: true });
}
console.log(`probe of no file: ${JSON.stringify(await probe({ command: ["/tmp/dccbu/no-such-command"], env }))}`);

show("C, a clean unit", await run(C, linter, "const x: number = 1;\n"));
{
  const unit: InputFile = {
    unitName: "/.src/a.ts",
    content: 'const x: number = "s";\n' + "//~ print {file}(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n" + "//~ print   A line of the chain.\n",
  };
  const expected = baselineOf([unit], [{ category: "error", code: 2322, messageText: "Type 'string' is not assignable to type 'number'.", next: [{ messageText: "A line of the chain." }], location: { file: unit.unitName, start: 6, length: 1 }, relatedInformation: [] }]);
  show("E, first section", await run(E, linter, unit.content, { oracle: () => expected }));
}
const rows: [string, string, { instance?: Instance; unitName?: string }?][] = [
  ["an exit code that is none of 0, 1 and 2", "//~ exit 7\n"],
  ["the exit code of a refusal", "//~ print error: no\n//~ exit 1\n"],
  ["the exit code 1 and the report of a sanitizer", "//~ print ==7==ERROR: AddressSanitizer: SEGV on unknown address 0x000000000008\n//~ print SUMMARY: AddressSanitizer: SEGV in parse\n//~ exit 1\n"],
  ["the exit code 1 and nothing on stderr", "//~ exit 1\n"],
  ["the exit code 1, one line and text on stdout", "//~ print error: no\n//~ stdout usage\n//~ exit 1\n"],
  ["a line of no form", "//~ print Bun has crashed\n//~ exit 0\n"],
  ["a panic and the exit code 0", "//~ print panic(main thread): index out of bounds\n//~ exit 0\n"],
  ["an error and the exit code 0", "//~ print {file}(1,1): error TS1: x\n//~ exit 0\n"],
  ["no error and the exit code 2", "//~ exit 2\n"],
  ["text on stdout", "//~ stdout hello\n"],
  ["a signal", "//~ kill SIGKILL\n"],
  ["a signal after a panic", "//~ print ============================================================\n//~ print Bun Debug v1.4.3 (3110ce85c) Linux x64\n//~ print Args: \"bun-debug\" \"--lint\" \"{file}\"\n//~ print panic(main thread): index out of bounds\n//~ stdout bun_js_parser::parse\n//~ kill SIGKILL\n"],
  ["a file that is not of the instance", "//~ print /etc/passwd(1,1): error TS1: x\n"],
  ["an error of the command", "//~ print error internal-error: an assertion of the checker\n"],
  ["an error of the command in a file", "//~ print {relative}(3,9): error internal-error: This file is nested too deeply to check all of it.\n"],
  ["a syntax error", '//~ print {relative}(1,7): error syntax: Expected identifier but found "="\n//~ print {relative}(1,7): error syntax: This constant must be initialized\n'],
  ["a warning of the parser", '//~ print {relative}(9,22): warning syntax: Reading from setter-only property "#value" will throw\n'],
  ["an operand that cannot be read", "//~ print error cannot-read-file: File '{file}' not found.\n"],
  ["an operand with an unsupported extension (printed)", "//~ print error unsupported-extension: File '{file}' has an unsupported extension. The only supported extensions are '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.cts', '.d.cts', '.cjs', '.mts', '.d.mts', '.mjs'.\n"],
  ["an operand with an unsupported extension (real)", "x\n", { unitName: "/.src/b.js.map" }],
  ["a name that is no rule, without a file", "//~ print error made-up-name: x\n"],
  ["a report of a rule, C", "debugger;\n//~ print {relative}(1,1): error no-debugger: Unexpected 'debugger' statement.\n"],
  ["a report of a rule, E", "debugger;\n//~ print {relative}(1,1): error no-debugger: Unexpected 'debugger' statement.\n", { instance: E }],
  ["two reports of rules and a syntax warning", "//~ print {relative}(1,1): error no-debugger: Unexpected 'debugger' statement.\n//~ print {relative}(2,5): warning use-isnan: Use the isNaN function to compare with NaN.\n//~ print {relative}(3,1): warning syntax: w\n"],
  ["a report of a rule beside a TypeScript error, C", "//~ print {relative}(1,1): error no-debugger: Unexpected 'debugger' statement.\n//~ print {relative}(1,1): error TS2322: x\n"],
  ["a stand-in", "//~ print error internal-stand-in: checker.getTypeOfExpression\n"],
  ["a stand-in and a rule", "//~ print error internal-stand-in: checker.getTypeOfExpression\n//~ print {relative}(1,1): error no-debugger: Unexpected 'debugger' statement.\n"],
  ["a stand-in and a syntax error", "//~ print error internal-stand-in: checker.getTypeOfExpression\n//~ print {relative}(1,1): error syntax: x\n"],
  ["the code -1", "//~ print error TS-1: Pre-emit (1) and post-emit (2) diagnostic counts do not match!\n"],
  ["a real syntax error of the fixture's parser", "const = ;\n"],
  ["a declaration file with a syntax error", "const = ;\n", { unitName: "/.src/a.d.ts" }],
];
for (const [label, content, more] of rows) show(label, await run(more?.instance ?? C, linter, content, { unitName: more?.unitName }));
show("a command that hangs", await run(C, linter, "//~ hang\n", { timeoutMs: 1500 }));
{
  const dir = mkdtempSync(join(tmpdir(), "dccbu-runs-"));
  const runs = createSpawnCheck({ command: command("runs-fixture.ts"), env, probeDirectory: join(dir, "probe") });
  const mark = join(dir, "the-instance-ran");
  show("a command that runs its operand", await run(C, runs, `require("node:fs").writeFileSync(${JSON.stringify(mark)}, "");\n`));
  console.log("    left:", readdirSync(dir));
  rmSync(dir, { recursive: true, force: true });
}
{
  const given = createSpawnCheck({ command: command("lints-fixture.ts"), env, probed: { ok: false, reason: "given by the caller" } });
  show("a verdict of the caller", await run(C, given, "const x = 1;\n"));
}
process.exit(0);
