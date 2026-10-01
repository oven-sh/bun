// Ground truth for the rules of TypeScript's harness: its own functions, cut out of src/harness at the pinned
// commit and run on the typescript package. Reads the cases of crosscheck.ts, one JSON per line.
// usage: node ts_harness.cjs <TypeScript checkout> <typescript.js> <cases.jsonl>
const fs = require("node:fs");
const path = require("node:path");

const [, , checkout, tsPath, casesPath] = process.argv;
const ts = require(tsPath);

function cut(file, from, to) {
  const text = fs.readFileSync(path.join(checkout, file), "utf8");
  const a = text.indexOf(from);
  const b = to === undefined ? -1 : text.indexOf(to, a);
  if (a < 0 || (to !== undefined && b < 0)) throw new Error(`cannot cut ${from} out of ${file}`);
  return to === undefined ? text.slice(a) : text.slice(a, b);
}
// One top-level declaration: from its first line to the first line that closes it at the same indentation.
function cutDeclaration(file, firstLine, indent) {
  const text = fs.readFileSync(path.join(checkout, file), "utf8");
  const a = text.indexOf(firstLine);
  if (a < 0) throw new Error(`cannot cut ${firstLine} out of ${file}`);
  const close = text.indexOf("\n" + indent + "}", a);
  return text.slice(a, close + indent.length + 2);
}

const source = [
  "const failed = [];",
  "const assert = { equal(a, b, message) { if (a !== b) failed.push(message); } };",
  'const IO = { newLine: () => "\\r\\n", useCaseSensitiveFileNames: () => false };',
  "const getCanonicalFileName = ts.createGetCanonicalFileName(IO.useCaseSensitiveFileNames());",
  'const libFolder = "built/local/";',
  'const vfs = { builtFolder: "/.ts" };',
  "const vpath = { addTrailingSeparator: ts.ensureTrailingDirectorySeparator, isTsConfigFile };",
  "const Utils = { removeTestPathPrefixes, canonicalizeForHarness: ts.createGetCanonicalFileName(false) };",
  cut("src/harness/util.ts", "const testPathPrefixRegExp", "function createDiagnosticMessageReplacer"),
  cutDeclaration("src/harness/vpathUtil.ts", "export function isTsConfigFile", ""),
  cutDeclaration("src/harness/harnessIO.ts", "export function isDefaultLibraryFile", ""),
  cutDeclaration("src/harness/harnessIO.ts", "export function isBuiltFile", ""),
  cut("src/harness/harnessIO.ts", "    export function minimalDiagnosticsToString", "    export function doErrorBaseline"),
  cutDeclaration("src/harness/harnessIO.ts", "    function checkDuplicatedFileName", "    "),
  cutDeclaration("src/harness/harnessIO.ts", "    export function sanitizeTestFilePath", "    "),
  "return { getErrorBaseline, failed };",
]
  .join("\n")
  .replace(/^(\s*)export /gm, "$1");

const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const harness = new Function("ts", js.replace(/^"use strict";/, ""))(ts);

// The UTF-16 offset of a byte offset; a byte offset two after the start of a rune of four bytes is its second half.
function unitsOf(bytes, offset) {
  let units = 0;
  let i = 0;
  while (i < offset) {
    const b = bytes[i];
    const size = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    if (size === 4 && i + 2 === offset) return units + 1;
    units += size === 4 ? 2 : 1;
    i += size;
  }
  return units + (offset - i);
}

const out = [];
for (const line of fs.readFileSync(casesPath, "utf8").split("\n")) {
  if (line === "") continue;
  const c = JSON.parse(line);
  const result = { name: c.name, text: "", failed: [], panic: "", skipped: "" };
  try {
    const decode = b64 => {
      const bytes = Buffer.from(b64, "base64");
      const text = bytes.toString("utf8");
      if (Buffer.from(text, "utf8").compare(bytes) !== 0) throw Object.assign(new Error("not UTF-8"), { skip: true });
      return { bytes, text };
    };
    const files = c.files.map(f => {
      const name = decode(f.name).text;
      const { bytes, text } = decode(f.text);
      const sourceFile = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
      sourceFile.path = name;
      sourceFile.resolvedPath = name;
      return { sourceFile, bytes };
    });
    const chainOf = d => ({ messageText: decode(d.message).text, category: d.category, code: d.code, next: d.chain.length > 0 ? d.chain.map(chainOf) : undefined });
    const convert = d => {
      const file = d.file < 0 ? undefined : files[d.file];
      const start = file === undefined ? undefined : unitsOf(file.bytes, d.pos);
      const end = file === undefined ? undefined : unitsOf(file.bytes, d.end);
      return {
        file: file === undefined ? undefined : file.sourceFile,
        start,
        length: file === undefined ? undefined : end - start,
        code: d.code,
        category: d.category,
        messageText: d.chain.length > 0 ? chainOf(d) : decode(d.message).text,
        relatedInformation: d.related.length > 0 ? d.related.map(convert) : undefined,
      };
    };
    const diagnostics = c.diagnostics.map(convert);
    const inputs = c.inputs.map(f => ({ unitName: decode(f.name).text, content: decode(f.text).text }));
    harness.failed.length = 0;
    const text = harness.getErrorBaseline(inputs, diagnostics, c.pretty);
    result.text = Buffer.from(text, "utf8").toString("base64");
    result.failed = [...harness.failed];
  } catch (e) {
    if (e.skip) result.skipped = e.message;
    else result.panic = String(e && e.message);
  }
  out.push(JSON.stringify(result));
}
process.stdout.write(out.join("\n") + "\n");
