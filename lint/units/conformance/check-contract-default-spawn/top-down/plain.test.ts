// Research prototype: the reader of the plain format on fixed strings, and on the first section of every oracle baseline.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { parsePlainDiagnostics, writePlainDiagnostics } from "./plain";

test("one located diagnostic", () => {
  expect(parsePlainDiagnostics("a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n")).toEqual({
    ok: true,
    diagnostics: [
      {
        path: "a.ts",
        line: 1,
        character: 7,
        category: "error",
        code: 2322,
        messageText: "Type 'string' is not assignable to type 'number'.",
        at: 1,
      },
    ],
  });
});

test("empty text is an empty list", () => {
  expect(parsePlainDiagnostics("")).toEqual({ ok: true, diagnostics: [] });
});

test("a chain: two spaces per level, siblings and a way back up", () => {
  const text =
    "src/a.ts(3,1): error TS2345: top\n" +
    "  one\n" +
    "    two\n" +
    "      three\n" +
    "    two again\n" +
    "  one again\n" +
    "error TS5023: Unknown compiler option 'x'.\n";
  const r = parsePlainDiagnostics(text);
  expect(r).toEqual({
    ok: true,
    diagnostics: [
      {
        path: "src/a.ts",
        line: 3,
        character: 1,
        category: "error",
        code: 2345,
        messageText: "top",
        at: 1,
        next: [
          { messageText: "one", next: [{ messageText: "two", next: [{ messageText: "three" }] }, { messageText: "two again" }] },
          { messageText: "one again" },
        ],
      },
      { category: "error", code: 5023, messageText: "Unknown compiler option 'x'.", at: 7 },
    ],
  });
  if (r.ok) expect(writePlainDiagnostics(r.diagnostics)).toBe(text);
});

test("a line that is deeper than one level below the line before keeps its spaces", () => {
  const text = "a.ts(1,1): error TS1: top\n      deep\n";
  const r = parsePlainDiagnostics(text);
  expect(r).toEqual({
    ok: true,
    diagnostics: [
      { path: "a.ts", line: 1, character: 1, category: "error", code: 1, messageText: "top", at: 1, next: [{ messageText: "    deep" }] },
    ],
  });
  if (r.ok) expect(writePlainDiagnostics(r.diagnostics)).toBe(text);
});

test("names: spaces, parentheses, a drive, a line break of Windows", () => {
  const r = parsePlainDiagnostics(
    "C:\\my dir\\(group)\\a.ts(10,20): warning TS6133: 'x' is declared but its value is never read.\r\n" +
      "../lib (1)/b.d.ts(2,3): suggestion TS80001: text (4,5): error TS1: inside\r\n",
  );
  expect(r.ok && r.diagnostics.map(d => [d.path, d.line, d.character, d.category, d.code, d.messageText])).toEqual([
    ["C:\\my dir\\(group)\\a.ts", 10, 20, "warning", 6133, "'x' is declared but its value is never read."],
    ["../lib (1)/b.d.ts", 2, 3, "suggestion", 80001, "text (4,5): error TS1: inside"],
  ]);
});

test("a line that starts with a category has no file", () => {
  const r = parsePlainDiagnostics("error TS-1: Not ported: checker.getTypeOfExpression (1,2): error TS2: x\n");
  expect(r.ok && r.diagnostics).toEqual([
    { category: "error", code: -1, messageText: "Not ported: checker.getTypeOfExpression (1,2): error TS2: x", at: 1 },
  ]);
});

test("the code of a rule", () => {
  const r = parsePlainDiagnostics("a.js(1,1): error no-debugger: Unexpected 'debugger' statement.\n");
  expect(r.ok && r.diagnostics).toEqual([
    { path: "a.js", line: 1, character: 1, category: "error", rule: "no-debugger", messageText: "Unexpected 'debugger' statement.", at: 1 },
  ]);
});

test.each([
  ["a crash report", "panic: index out of bounds\n", 1],
  ["a code frame", "a.ts(1,1): error TS1005: ';' expected.\n1 | const = ;\n", 2],
  ["an empty line", "a.ts(1,1): error TS1005: ';' expected.\n\nb.ts(1,1): error TS1005: ';' expected.\n", 2],
  ["a chain line first", "  Type 'a' is not assignable to type 'b'.\n", 1],
  ["one space", "a.ts(1,1): error TS1: x\n y\n", 2],
  ["spaces only", "a.ts(1,1): error TS1: x\n    \n", 2],
  ["no line break at the end", "a.ts(1,1): error TS1: x", 1],
  ["no code", "a.ts(1,1): error: x\n", 1],
  ["a summary", "a.ts(1,1): error TS1: x\nFound 1 error in a.ts:1\n", 2],
  ["line zero", "a.ts(0,1): error TS1: x\n", 1],
  ["an unknown category", "a.ts(1,1): fatal TS1: x\n", 1],
  ["a debug log", "[SYS] open(a.ts) = 3\na.ts(1,1): error TS1: x\n", 1],
])("refused: %s", (_name, text, at) => {
  const r = parsePlainDiagnostics(text);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.at).toBe(at);
});

test("the first section of every oracle baseline in the plain form reads and writes back", () => {
  const root = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
  let files = 0;
  let diagnostics = 0;
  const bad: string[] = [];
  for (const suite of ["compiler", "conformance"]) {
    for (const name of readdirSync(`${root}/${suite}`)) {
      if (!name.endsWith(".errors.txt")) continue;
      const text = readFileSync(`${root}/${suite}/${name}`, "latin1");
      if (text.startsWith("\x1b[")) continue;
      const lines = text.split("\r\n");
      let end = lines.findIndex(l => l.startsWith("!!! ") || /^==== .* \(\d+ errors\) ====$/s.test(l));
      if (end < 0) end = lines.length;
      while (end > 0 && lines[end - 1] === "") end--;
      // The harness masks the position in a library file: no tool prints that.
      const top = lines
        .slice(0, end)
        .map(l => l.replace(/^(lib.*\.d\.ts)\(--,--\)/i, "$1(1,1)") + "\n")
        .join("");
      const r = parsePlainDiagnostics(top);
      files++;
      if (!r.ok) bad.push(`${suite}/${name}: line ${r.at}: ${r.reason}`);
      else {
        diagnostics += r.diagnostics.length;
        if (writePlainDiagnostics(r.diagnostics) !== top) bad.push(`${suite}/${name}: does not write back`);
      }
    }
  }
  expect(bad).toEqual([]);
  expect({ files, diagnostics }).toEqual({ files: 7013, diagnostics: 40399 });
});
