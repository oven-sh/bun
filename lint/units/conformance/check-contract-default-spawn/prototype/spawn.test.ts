import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type CheckInput, type CheckUnit, createSpawnCheck, materialise, probe } from "./check";
import { parsePlainDiagnostics } from "./plain_format";

const exe = process.execPath;
const env = { ...process.env, NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1" } as Record<string, string | undefined>;
const fixture = (name: string) => [exe, join(import.meta.dir, "fixtures", name)];

function input(units: Record<string, string>, more: Partial<CheckInput> = {}): CheckInput & { dispose(): void } {
  const roots: CheckUnit[] = Object.entries(units).map(([name, content]) => ({ name, content }));
  const base = {
    name: "case.ts",
    config: undefined,
    currentDirectory: "/.src",
    configFile: undefined,
    roots,
    otherFiles: [],
    links: new Map<string, string>(),
    programFileNames: roots.map(u => u.name),
    useCaseSensitiveFileNames: true,
    pretty: false,
    ...more,
  };
  let m: ReturnType<typeof materialise> | undefined;
  return { ...base, materialise: () => (m ??= materialise(base)), dispose: () => m?.dispose() };
}
const all = () => undefined;

describe("plain format", () => {
  test("reads heads, chains and diagnostics without a file", () => {
    const r = parsePlainDiagnostics(
      [
        "a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
        "dir/b (1).ts(12,3): error TS2345: Argument of type 'A' is not assignable to parameter of type 'B'.",
        "  Types of property 'x' are incompatible.",
        "    Type 'string' is not assignable to type 'number'.",
        "  Second branch.",
        "error TS2318: Cannot find global type 'Array'.",
        "c.ts(3,1): message TS1450: Dynamic imports can only accept a module specifier and an optional set of attributes as arguments",
        "",
      ].join("\n"),
    );
    expect(r).toEqual({
      ok: true,
      diagnostics: [
        { path: "a.ts", line: 1, column: 7, category: "error", codeText: "TS2322", code: 2322, messageText: "Type 'string' is not assignable to type 'number'.", messageChain: [], stderrLine: 1 },
        {
          path: "dir/b (1).ts",
          line: 12,
          column: 3,
          category: "error",
          codeText: "TS2345",
          code: 2345,
          messageText: "Argument of type 'A' is not assignable to parameter of type 'B'.",
          messageChain: [
            { messageText: "Types of property 'x' are incompatible.", messageChain: [{ messageText: "Type 'string' is not assignable to type 'number'.", messageChain: [] }] },
            { messageText: "Second branch.", messageChain: [] },
          ],
          stderrLine: 2,
        },
        { path: undefined, line: 0, column: 0, category: "error", codeText: "TS2318", code: 2318, messageText: "Cannot find global type 'Array'.", messageChain: [], stderrLine: 6 },
        { path: "c.ts", line: 3, column: 1, category: "message", codeText: "TS1450", code: 1450, messageText: "Dynamic imports can only accept a module specifier and an optional set of attributes as arguments", messageChain: [], stderrLine: 7 },
      ],
    });
  });
  test.each([
    ["panicked at src/x.rs:1:1\n", 1, "neither a diagnostic nor a chain line"],
    ["  Type 'a'.\n", 1, "chain line without a diagnostic before it"],
    ["a.ts(1,1): error TS1: m\n      deep\n", 2, "chain line of depth 3 after depth 0"],
    ["a.ts(1,1): error TS1: m\n\n", 2, "neither a diagnostic nor a chain line"],
    ["a.ts(1,1): error TS1: m\n   odd\n", 2, "neither a diagnostic nor a chain line"],
    ["a.ts(1,1): error TS1: m", 1, "the last line has no line end"],
    ["a.ts(0,1): error TS1: m\n", 1, "line and column are 1-based"],
    ["a.ts(1,1): fatal TS1: m\n", 1, "neither a diagnostic nor a chain line"],
  ])("refuses %j", (text, stderrLine, reason) => {
    expect(parsePlainDiagnostics(text)).toMatchObject({ ok: false, stderrLine, reason });
  });
  test("empty output is an empty list and CR LF is a line end", () => {
    expect(parsePlainDiagnostics("")).toEqual({ ok: true, diagnostics: [] });
    const r = parsePlainDiagnostics("a.ts(1,1): error TS1: m\r\n  c\r\n");
    expect(r.ok && r.diagnostics[0].messageChain).toEqual([{ messageText: "c", messageChain: [] }]);
  });
});

describe("probe", () => {
  test("accepts a command that lints", async () => {
    expect(await probe({ command: fixture("fake-lint.ts"), env })).toEqual({ ok: true });
  });
  test("refuses a command that runs its operand", async () => {
    expect(await probe({ command: fixture("fake-runs-operand.ts"), env })).toMatchObject({ ok: false, reason: "executes-operand" });
  });
  test("refuses a command that checks nothing", async () => {
    expect(await probe({ command: fixture("fake-silent.ts"), env })).toMatchObject({ ok: false, reason: "error-file" });
  });
  test("refuses a command that refuses the flag", async () => {
    expect(await probe({ command: fixture("fake-refuses.ts"), env })).toMatchObject({ ok: false, reason: "clean-file" });
  });
  test("refuses a command that does not exist", async () => {
    expect(await probe({ command: ["/nonexistent/lint-conformance"], env })).toMatchObject({ ok: false, reason: "clean-file" });
  });
});

describe("spawn check", () => {
  const check = createSpawnCheck({ command: fixture("fake-lint.ts"), env }, all);
  const run = async (units: Record<string, string>, more: Partial<CheckInput> = {}, with_ = check) => {
    const i = input(units, more);
    try {
      return await with_.check(i);
    } finally {
      i.dispose();
    }
  };
  test("a file without an error gives an empty list", async () => {
    expect(await run({ "/.src/a.ts": "const x: number = 1;\n" })).toEqual({ kind: "plain", diagnostics: [], provisional: [], ignoredRuleDiagnostics: 0 });
  });
  test("diagnostics carry the virtual name", async () => {
    expect(await run({ "/.src/a.ts": 'const x: number = "s";\n', "/lib/b.ts": '\n  const y: number = "t";\n' })).toEqual({
      kind: "plain",
      diagnostics: [
        { file: "/.src/a.ts", line: 1, column: 7, category: "error", code: 2322, messageText: "Type 'string' is not assignable to type 'number'.", messageChain: [] },
        { file: "/lib/b.ts", line: 2, column: 9, category: "error", code: 2322, messageText: "Type 'string' is not assignable to type 'number'.", messageChain: [] },
      ],
      provisional: [],
      ignoredRuleDiagnostics: 0,
    });
  });
  test("the real root is taken out of message text and an absolute path is accepted", async () => {
    const r = await run({ "/.src/a.ts": "//! stderr: <path>(1,1): error TS6053: File '<path>.missing' not found.\n" });
    expect(r).toEqual({
      kind: "plain",
      diagnostics: [{ file: "/.src/a.ts", line: 1, column: 1, category: "error", code: 6053, messageText: "File '/.src/a.ts.missing' not found.", messageChain: [] }],
      provisional: [],
      ignoredRuleDiagnostics: 0,
    });
  });
  test("a library file keeps its base name and a foreign file is a failure", async () => {
    expect(await run({ "/.src/a.ts": "//! stderr: /opt/libs/lib.es5.d.ts(4,5): error TS2300: Duplicate identifier 'A'.\n" })).toMatchObject({
      kind: "plain",
      diagnostics: [{ file: "bundled:///libs/lib.es5.d.ts", line: 4, column: 5 }],
    });
    expect(await run({ "/.src/a.ts": "//! stderr: /etc/passwd(1,1): error TS1005: ';' expected.\n" })).toMatchObject({ kind: "failure", failure: "path" });
  });
  test("a rule diagnostic is counted and left out, a stand-in makes the result provisional", async () => {
    expect(
      await run({
        "/.src/a.ts": "//! stderr: <name>(1,1): error no-debugger: Unexpected 'debugger' statement.\n//! stderr: error internal-stand-in: get_type_of_expression\n",
      }),
    ).toEqual({ kind: "plain", diagnostics: [], provisional: ["get_type_of_expression"], ignoredRuleDiagnostics: 1 });
  });
  test.each([
    ["a line that is no diagnostic", "//! stderr: thread panicked\n", "stderr"],
    ["exit code 0 with an error", "//! stderr: <name>(1,1): error TS1005: ';' expected.\n//! exit: 0\n", "exit-mismatch"],
    ["exit code 2 without an error", "//! exit: 2\n", "exit-mismatch"],
    ["exit code 1", "//! exit: 1\n", "refused"],
    ["another exit code", "//! exit: 70\n", "exit-code"],
    ["a signal", 'const x: number = "s";\n//! signal: SIGSEGV\n', "signal"],
    ["output on stdout", "//! stdout: hello\n", "stdout"],
    ["an internal error", "//! stderr: error internal-error: assertion failed in check_expression\n", "internal"],
  ])("%s is a failure", async (_, content, kind) => {
    expect(await run({ "/.src/a.ts": content })).toMatchObject({ kind: "failure", failure: kind });
  });
  test("a run that does not end is a failure", async () => {
    const short = createSpawnCheck({ command: fixture("fake-lint.ts"), env, timeoutMs: 300 }, all);
    expect(await run({ "/.src/a.ts": "//! spin:\n" }, {}, short)).toMatchObject({ kind: "failure", failure: "timeout", signal: "SIGKILL" });
  });
  test("a command that runs its operand gets no case", async () => {
    const bad = createSpawnCheck({ command: fixture("fake-runs-operand.ts"), env }, all);
    const i = input({ "/.src/a.ts": `require("node:fs").writeFileSync(__dirname + "/ran", "x");\n` });
    try {
      expect(await bad.check(i)).toMatchObject({ kind: "failure", failure: "probe" });
      expect(await Bun.file(i.materialise().toReal("/.src/ran")).exists()).toBe(false);
    } finally {
      i.dispose();
    }
  });
  test("what the command line cannot carry is refused before the spawn", async () => {
    const strict = createSpawnCheck({ command: fixture("fake-lint.ts"), env }, i => (i.config !== undefined ? "compiler options" : undefined));
    const i = input({ "/.src/a.ts": "" }, { config: new Map([["target", "es2015"]]) });
    expect(await strict.check(i)).toEqual({ kind: "failure", failure: "unsupported", detail: "compiler options" });
  });
});
