// Hand-made cases of the writer, run through the reference's code and through the port; prints both when they differ.
// usage: bun examples.ts <gt binary> [--vectors out.jsonl]
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Diagnostic, FileLike } from "./diagnosticwriter";
import { type TestFile, getErrorBaseline } from "./error_baseline";

const gt = process.argv[2];
const u = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
const b64 = (s: string): string => Buffer.from(s, "latin1").toString("base64");
const file = (fileName: string, text: string): FileLike => ({ fileName, text: u(text) });
const diag = (f: FileLike | undefined, pos: number, end: number, message = "Message.", extra: Partial<Diagnostic> = {}): Diagnostic => ({
  file: f, pos, end, code: 2322, category: 1, source: "", message: u(message), messageChain: [], relatedInformation: [], ...extra,
});
const at = (f: FileLike, needle: string, length = needle.length, nth = 0): [number, number] => {
  const text = f.text;
  let i = -1;
  for (let k = 0; k <= nth; k++) i = text.indexOf(u(needle), i + 1);
  return [i, i + u(needle.slice(0, length)).length];
};

interface Example { name: string; pretty?: boolean; inputs: FileLike[]; diagnostics: Diagnostic[] }
const examples: Example[] = [];
{
  const a = file("/.src/a.ts", "let x = 1;\nfoo(bar);\n\nlast");
  examples.push({ name: "zero length in a line, at the end of a line, at the end of the text", inputs: [a], diagnostics: [
    diag(a, 4, 4, "Zero in line."), diag(a, 10, 10, "Zero at end of line."), diag(a, a.text.length, a.text.length, "Zero at end of text."),
  ] });
  examples.push({ name: "span that ends at the line break, and span that holds the line break", inputs: [a], diagnostics: [
    diag(a, 4, 10, "Ends before LF."), diag(a, 15, 21, "Holds LF."),
  ] });
  examples.push({ name: "span over an empty line, to the middle of the last line", inputs: [a], diagnostics: [diag(a, 11, 24, "Multi.")] });
  examples.push({ name: "two spans that start at one column, and a span inside a span", inputs: [a], diagnostics: [
    diag(a, 11, 14, "Short."), diag(a, 11, 19, "Long."), diag(a, 15, 18, "Inner."),
  ] });
}
{
  const a = file("/.src/a.ts", "\tconst \u{1d608}\u00e9 = '\u4e2d';\n\u00a0\u000b\u000c x;");
  examples.push({ name: "tab, astral, two-byte and three-byte runes before and inside spans; NBSP, VT and FF before a span", inputs: [a], diagnostics: [
    diag(a, ...at(a, "\u{1d608}\u00e9"), "Name."), diag(a, ...at(a, "'\u4e2d'"), "String."), diag(a, ...at(a, "x"), "After NBSP VT FF."),
  ] });
}
{
  const a = file("/.src/a.ts", "one\r\ntwo\r\nthree");
  examples.push({ name: "text with CR LF: span that ends at CR, span on the next line", inputs: [a], diagnostics: [diag(a, 0, 3, "Ends at CR."), diag(a, 5, 8, "two.")] });
  examples.push({ name: "text with CR LF: span that ends between CR and LF", inputs: [a], diagnostics: [diag(a, 0, 4, "Holds CR.")] });
  examples.push({ name: "text with CR LF: span that starts at the LF", inputs: [a], diagnostics: [diag(a, 4, 5, "At LF.")] });
}
{
  const a = file("/.src/a.ts", "one\rtwo\nthree\nfour");
  examples.push({ name: "lone CR inside the first line: the span of the word 'three'", inputs: [a], diagnostics: [diag(a, ...at(a, "three"), "three.")] });
  examples.push({ name: "lone CR inside the first line: the span of the word 'four'", inputs: [a], diagnostics: [diag(a, ...at(a, "four"), "four.")] });
  const b = file("/.src/b.ts", "one\u2028two\nthree");
  examples.push({ name: "U+2028 inside the first line: the span of the word 'one'", inputs: [b], diagnostics: [diag(b, 0, 3, "one.")] });
  examples.push({ name: "U+2028 inside the first line: the span of the word 'two'", inputs: [b], diagnostics: [diag(b, ...at(b, "two"), "two.")] });
}
{
  const upper = file("/.src/A.ts", "upper();");
  const lower = file("/.src/a.ts", "lower();");
  examples.push({ name: "two inputs whose names differ in case", inputs: [upper, lower], diagnostics: [diag(upper, 0, 5, "In A.ts."), diag(lower, 0, 5, "In a.ts.")] });
}
{
  const lib = file("/.src/lib.d.ts", "declare var x: number;");
  const other = file("/.src/library/y.d.ts", "declare var y: number;");
  const bundled = file("bundled:///libs/lib.es5.d.ts", "\n\ndeclare var eval: any;");
  const react = file("/.lib/react16.d.ts", "\n  declare var React: any;");
  const a = file("/.src/a.ts", "var eval;");
  examples.push({ name: "library names: an input named lib.d.ts, an input under a directory that starts with lib, a bundled library, a test library", inputs: [lib, other, a], diagnostics: [
    diag(lib, 12, 13, "In input lib.d.ts."), diag(other, 12, 13, "In library/y.d.ts."), diag(a, 4, 8, "Duplicate.", { relatedInformation: [
      diag(bundled, 14, 18, "Also here (bundled).", { code: 6203, category: 3 }), diag(react, 16, 21, "Also here (test library).", { code: 6203, category: 3 }), diag(undefined, 0, 0, "No file.", { code: 6204, category: 3 }),
      diag(lib, 12, 13, "Also here (input lib).", { code: 6203, category: 3 }),
    ] }),
    diag(bundled, 14, 18, "In bundled library."), diag(react, 16, 21, "In test library."),
  ] });
}
{
  const a = file("/.src/a.ts", "f(x);");
  const chain = (message: string, next: Diagnostic[] = []): Diagnostic => diag(undefined, 0, 0, message, { messageChain: next });
  examples.push({ name: "chain with siblings, a message with line breaks and an empty line, a global diagnostic, related information with a chain", inputs: [a], diagnostics: [
    diag(undefined, 0, 0, "Global with /.src/a.ts and bundled:///libs/lib.d.ts in its text.", { code: 5053 }),
    diag(a, 2, 3, "Head.", { messageChain: [chain("First.", [chain("First of first."), chain("Second of first.")]), chain("Second.")], relatedInformation: [
      diag(a, 0, 1, "Related head with /.src/a.ts.", { code: 6500, category: 3, messageChain: [chain("Related first.", [chain("Related nested.")])] }),
    ] }),
    diag(a, 0, 1, "Line one\nline two\r\n\r\nline four /.src/a.ts"),
  ] });
}
{
  const a = file("/.src/a.ts", "function f() {\n\t\tconst x: string = 12;  \n}\n// 4\n// 5\n// 6\n// 7\nend");
  const b = file("/.src/b.ts", "let \u{1d608} = 1;");
  examples.push({ name: "pretty: one line, no length, seven lines, related information, a global diagnostic, three categories", pretty: true, inputs: [a, b], diagnostics: [
    diag(undefined, 0, 0, "Global.", { code: 5053 }),
    diag(a, ...at(a, "x"), "One line.", { relatedInformation: [diag(b, ...at(b, "\u{1d608}"), "Declared here.", { code: 6203, category: 3 }), diag(undefined, 0, 0, "No file.", { code: 6204, category: 3 })] }),
    diag(a, 9, 9, "No length.", { category: 2 }),
    diag(a, 0, a.text.length - 1, "Seven lines.", { category: 3, messageChain: [diag(undefined, 0, 0, "Chain.")] }),
    diag(b, ...at(b, "\u{1d608}"), "Astral.", { category: 0 }),
  ] });
  examples.push({ name: "pretty: one error", pretty: true, inputs: [a], diagnostics: [diag(a, ...at(a, "x"), "One.")] });
  examples.push({ name: "pretty: no error, one message", pretty: true, inputs: [a], diagnostics: [diag(a, ...at(a, "x"), "One.", { category: 3 })] });
  examples.push({ name: "pretty: a span that starts in the white space at the end of a line and goes on", pretty: true, inputs: [a], diagnostics: [diag(a, 38, 41, "Starts in trailing space.")] });
}
{
  const a = file("/.src/a.ts", "ab\xffcd \xf0\x9d x");
  a.text = "ab\xffcd \xf0\x9d x";
  examples.push({ name: "bytes that are not UTF-8 before and inside a span", inputs: [a], diagnostics: [diag(a, 3, 5, "After 0xff."), diag(a, 6, 9, "Holds a cut rune."), diag(a, 9, 10, "After it.")] });
}

const toJson = (e: Example): string => {
  const files: FileLike[] = [];
  const index = (f: FileLike | undefined): number => (f === undefined ? -1 : files.indexOf(f) >= 0 ? files.indexOf(f) : files.push(f) - 1);
  const conv = (d: Diagnostic): unknown => ({ file: index(d.file), pos: d.pos, end: d.end, code: d.code, category: d.category, source: d.source, message: b64(d.message), chain: d.messageChain.map(conv), related: d.relatedInformation.map(conv) });
  const diagnostics = e.diagnostics.map(conv);
  return JSON.stringify({ name: e.name, pretty: e.pretty ?? false, files: files.map(f => ({ name: b64(f.fileName), text: b64(f.text) })), inputs: e.inputs.map(f => ({ name: b64(f.fileName), text: b64(f.text) })), diagnostics });
};
const lines = examples.map(toJson);
writeFileSync("/tmp/ebf/examples.in.jsonl", lines.join("\n") + "\n");
const r = spawnSync(gt, ["/tmp/ebf/examples.in.jsonl"], { maxBuffer: 1 << 28, encoding: "utf8" });
if (r.status !== 0) throw new Error(r.stderr);
const results = r.stdout.split("\n").filter(l => l !== "").map(l => JSON.parse(l) as { text: string; failed: string[] | null; panic: string });
const vectorsAt = process.argv.indexOf("--vectors");
if (vectorsAt >= 0) writeFileSync(process.argv[vectorsAt + 1], lines.map((l, i) => JSON.stringify({ ...JSON.parse(l), expected: { text: results[i].text, failed: results[i].failed ?? [], panic: results[i].panic } })).join("\n") + "\n");
const visible = (s: string): string => s.replace(/\r\n/g, "\u240d\u240a\n").replace(/\r/g, "\u240d").replace(/\x1b/g, "\u241b").replace(/\t/g, "\u2192").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, c => `<${c.charCodeAt(0).toString(16)}>`);
examples.forEach((e, i) => {
  const g = results[i];
  const goText = Buffer.from(g.text, "base64").toString("latin1");
  let mine = "";
  let thrown = "";
  let failed: string[] = [];
  try {
    const w = getErrorBaseline(e.inputs.map((f): TestFile => ({ unitName: f.fileName, content: f.text })), e.diagnostics, (x, y) => e.diagnostics.indexOf(x) - e.diagnostics.indexOf(y), e.pretty ?? false, "tsgo");
    mine = w.text;
    failed = w.failedChecks;
  } catch (err) {
    thrown = (err as Error).message;
  }
  console.log(`######## ${e.name}`);
  if (g.panic !== "") console.log(`reference stops: ${g.panic}; port stops: ${thrown}`);
  else {
    console.log(visible(Buffer.from(goText, "latin1").toString("utf8")));
    if ((g.failed ?? []).length > 0) console.log(`   [failed checks of the reference: ${(g.failed ?? []).join("; ")}] [port: ${failed.join("; ")}]`);
    if (mine !== goText) console.log("   !!!! THE PORT DIFFERS: " + (thrown || visible(Buffer.from(mine, "latin1").toString("utf8"))));
  }
});
