// Research prototype: the check that spawns a command, against commands that stand for a linter.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tsgoRules } from "../../error-baseline-format/top-down/diagnosticwriter";
import { getErrorBaseline } from "../../error-baseline-format/top-down/error_baseline";
import { type Diagnostic, toWriterInput } from "../../error-baseline-format/top-down/shape";
import { type CheckInput, type MaterialiseResult, createSpawnCheck, probe } from "./check";
import { type Oracle, runInstances } from "./run";

const exe = process.execPath;
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } as Record<string, string | undefined>;
const fake = (name: string) => [exe, join(import.meta.dir, "fakes", name)];
const base = mkdtempSync(join(realpathSync(tmpdir()), "ccds-spawn-"));
process.on("exit", () => rmSync(base, { recursive: true, force: true }));
let made = 0;

function inputOf(name: string, files: Record<string, string>, roots = Object.keys(files)): CheckInput {
  const all = Object.entries(files).map(([n, content]) => ({ name: "/.src/" + n, content }));
  const id = made++;
  return {
    name,
    suite: "compiler",
    casePath: name,
    configuration: {},
    compilerOptions: { noErrorTruncation: true },
    defaultOptions: { newLine: "crlf", skipDefaultLibCheck: true },
    captureSuggestions: false,
    useCaseSensitiveFileNames: true,
    currentDirectory: "/.src",
    configFile: undefined,
    roots: all.filter(f => roots.includes(f.name.slice(6))),
    otherFiles: all.filter(f => !roots.includes(f.name.slice(6))),
    rootNames: roots.map(r => "/.src/" + r),
    links: [],
    includeLibDirectory: false,
    materialise(): MaterialiseResult {
      const root = `${base}/${id}`;
      for (const f of all) {
        mkdirSync(dirname(root + f.name), { recursive: true });
        writeFileSync(root + f.name, f.content);
      }
      return {
        ok: true,
        value: {
          root,
          currentDirectory: root + "/.src",
          rootNames: roots.map(r => `${root}/.src/${r}`),
          toReal: v => root + v,
          toVirtual: p => (p.startsWith(root + "/") ? p.slice(root.length) : undefined),
          mapText: t => t.replaceAll(root + "/", "/").replaceAll(root, "/"),
        },
      };
    },
  };
}

// The baseline that the reference writes for the diagnostics, with spans.
function oracleFor(input: CheckInput, diagnostics: Diagnostic[]): Oracle {
  if (diagnostics.length === 0) return { kind: "C" };
  const files = [...input.roots, ...input.otherFiles].map(f => ({ unitName: f.name, content: f.content }));
  const w = toWriterInput(tsgoRules, files, diagnostics);
  const text = getErrorBaseline(tsgoRules, w.files, w.diagnostics, false).text;
  return { kind: "E", bytes: tsgoRules.model.toBytes(text), path: "" };
}

const source = 'const x: number = "s";\n';
const expected: Diagnostic[] = [
  {
    category: "error",
    code: 2322,
    messageText: "Type 'string' is not assignable to type 'number'.",
    next: [{ messageText: "A line of the chain." }],
    location: { file: "/.src/a.ts", start: 6, length: 1 },
    relatedInformation: [],
  },
];
const printed =
  "//~ print {file}(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n//~ print   A line of the chain.\n";

test("the probe accepts a command that lints", async () => {
  expect(await probe({ command: fake("lints.ts"), env })).toEqual({ ok: true, reason: "" });
});

test("the probe refuses a command that runs its operand", async () => {
  expect(await probe({ command: fake("runs.ts"), env })).toEqual({
    ok: false,
    reason: "the command ran the file that it was to check",
  });
});

test("the probe refuses a command that dies", async () => {
  const r = await probe({ command: fake("crashes.ts"), env });
  expect(r).toEqual({ ok: false, reason: "a file without an error: the command ended by the signal SIGKILL" });
});

test("the probe refuses a command that takes the flag and does nothing", async () => {
  const r = await probe({ command: fake("silent.ts"), env });
  expect(r).toEqual({ ok: false, reason: "a file with a syntax error gave no error in it (exit code 0)" });
});

test("the probe refuses a command that is no file", async () => {
  const r = await probe({ command: [join(base, "no-such-command")], env });
  expect(r.ok).toBe(false);
  expect(r.reason).toStartWith("a file without an error: the command did not start: ");
});

test("a command that runs its operand gets no instance", async () => {
  const input = inputOf("marks.ts", { "marks.ts": `require("node:fs").writeFileSync(${JSON.stringify(base + "/instance-ran")}, "");\n` });
  const [r] = await runInstances([input], createSpawnCheck({ command: fake("runs.ts"), env }), { oracle: () => ({ kind: "C" }) });
  expect(r).toMatchObject({ status: "error", kind: "C", reason: "refusal: the command is no linter: the command ran the file that it was to check" });
  expect(await Bun.file(base + "/instance-ran").exists()).toBe(false);
});

const unsupported = "the run did not have the options of the instance";

test("a run by operands has no options: it never passes, and its first section is reported on request", async () => {
  const input = inputOf("a.ts", { "a.ts": source + printed });
  const oracle = oracleFor(input, expected);
  const check = createSpawnCheck({ command: fake("lints.ts"), env });
  const [strict] = await runInstances([input], check, { oracle: () => oracle });
  expect(strict).toEqual({ name: "a.ts", suite: "compiler", kind: "E", status: "unsupported", reason: unsupported });
  const [r] = await runInstances([input], check, { oracle: () => oracle, loose: true });
  expect(r).toEqual({ name: "a.ts", suite: "compiler", kind: "E", status: "unsupported", reason: unsupported, loose: { equal: true, reason: "" } });
});

test("an instance without an error: the same", async () => {
  const input = inputOf("c.ts", { "c.ts": "const x: number = 1;\n" });
  const [r] = await runInstances([input], createSpawnCheck({ command: fake("lints.ts"), env }), { oracle: () => ({ kind: "C" }), loose: true });
  expect(r).toEqual({ name: "c.ts", suite: "compiler", kind: "C", status: "unsupported", reason: unsupported, loose: { equal: true, reason: "" } });
});

test.each([
  ["a signal", "//~ kill SIGKILL\n", "error", "crash: the command ended by the signal SIGKILL"],
  ["an exit code that is none of 0, 1 and 2", "//~ exit 7\n", "error", "crash: the command ended with the exit code 7"],
  ["the exit code of a refusal", "//~ print error: no\n//~ exit 1\n", "error", "refusal: the command refused: error: no"],
  ["a line of no form", "//~ print Bun has crashed\n//~ exit 0\n", "error", "protocol: stderr line 1 is neither a diagnostic nor a line of a message chain: Bun has crashed"],
  ["an error and the exit code 0", "//~ print {file}(1,1): error TS1: x\n//~ exit 0\n", "error", "protocol: the exit code is 0 and stderr has 1 errors"],
  ["no error and the exit code 2", "//~ exit 2\n", "error", "protocol: the exit code is 2 and stderr has no error"],
  ["text on stdout", "//~ stdout hello\n", "error", "protocol: the command wrote to stdout: hello"],
  ["a file that is not of the instance", "//~ print /etc/passwd(1,1): error TS1: x\n", "error", "protocol: stderr line 1 names a file that is not of the instance: /etc/passwd"],
  ["an error of the command", "//~ print error internal-error: an assertion of the checker\n", "error", "internal: the command reports an error of its own: an assertion of the checker"],
])("never an empty list: %s", async (_name, orders, status, reason) => {
  const input = inputOf("f.ts", { "f.ts": orders });
  const [r] = await runInstances([input], createSpawnCheck({ command: fake("lints.ts"), env }), { oracle: () => ({ kind: "C" }), loose: true });
  expect({ status: r.status, reason: r.reason, loose: r.loose }).toEqual({ status, reason, loose: undefined });
});

test.each([
  ["a stand-in", "//~ print error internal-stand-in: checker.getTypeOfExpression\n", "provisional: reached 1 stand-ins"],
  ["the code -1", "//~ print error TS-1: Pre-emit (1) and post-emit (2) diagnostic counts do not match!\n", "fail: a diagnostic has the code -1"],
  ["a diagnostic of a rule", "//~ print {file}(1,1): error no-debugger: Unexpected 'debugger' statement.\n", "fail: equal but for diagnostics of rules: no-debugger"],
])("never equal: %s", async (_name, orders, reason) => {
  const input = inputOf("g.ts", { "g.ts": orders });
  const [r] = await runInstances([input], createSpawnCheck({ command: fake("lints.ts"), env }), { oracle: () => ({ kind: "C" }), loose: true });
  expect(r.status).toBe("unsupported");
  expect(r.loose).toEqual({ equal: false, reason });
});

test("a command that does not end is a failure", async () => {
  const input = inputOf("h.ts", { "h.ts": "//~ hang\n" });
  const check = createSpawnCheck({ command: fake("lints.ts"), env });
  const [r] = await runInstances([input], check, { oracle: () => ({ kind: "C" }), timeoutMs: 1 });
  expect({ status: r.status, reason: r.reason }).toEqual({ status: "error", reason: "timeout: the command did not end in time" });
});

test("the roots are the operands, and a name in another directory is mapped", async () => {
  const input = inputOf(
    "m.ts",
    { "m.ts": "//~ print ../.src/lib/other.ts(2,3): error TS2304: Cannot find name 'y'.\n", "lib/other.ts": "\n  y;\n" },
    ["m.ts"],
  );
  const oracle = oracleFor(input, [
    { category: "error", code: 2304, messageText: "Cannot find name 'y'.", location: { file: "/.src/lib/other.ts", start: 3, length: 1 }, relatedInformation: [] },
  ]);
  const [r] = await runInstances([input], createSpawnCheck({ command: fake("lints.ts"), env }), { oracle: () => oracle, loose: true });
  expect(r).toEqual({ name: "m.ts", suite: "compiler", kind: "E", status: "unsupported", reason: unsupported, loose: { equal: true, reason: "" } });
});

test("a rule that the caller names is counted and left out", async () => {
  const input = inputOf("r.ts", { "r.ts": "//~ print {file}(1,1): error no-debugger: Unexpected 'debugger' statement.\n" });
  const check = createSpawnCheck({ command: fake("lints.ts"), env, ignoreRules: ["no-debugger"] });
  const [r] = await runInstances([input], check, { oracle: () => ({ kind: "C" }), loose: true });
  expect(r).toEqual({ name: "r.ts", suite: "compiler", kind: "C", status: "unsupported", reason: unsupported, loose: { equal: true, reason: "" } });
});

test("the level follows from the result, not from the bytes", async () => {
  // The span of the diagnostic is empty: with it and without it the bytes of the baseline are the same.
  const { checkOf } = await import("./check");
  const input = inputOf("z.ts", { "z.ts": "let\n" });
  const at = { file: "/.src/z.ts", line: 1, character: 4 };
  const known: Diagnostic = { category: "error", code: 1123, messageText: "Variable declaration list cannot be empty.", location: { ...at, start: 3, length: 0 }, relatedInformation: [] };
  const oracle = oracleFor(input, [known]);
  const run = async (d: Diagnostic) =>
    (await runInstances([input], checkOf("fixed", () => ({ kind: "diagnostics", diagnostics: [d], standIns: [], configured: true })), { oracle: () => oracle }))[0];
  expect(await run(known)).toMatchObject({ status: "pass", level: "baseline" });
  expect(await run({ ...known, location: at })).toMatchObject({ status: "pass", level: "first-section" });
  expect(await run({ ...known, relatedInformation: undefined })).toMatchObject({ status: "pass", level: "first-section" });
});
