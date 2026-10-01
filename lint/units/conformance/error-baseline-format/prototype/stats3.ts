// Statistics of the parsed baselines: kinds of spans, files without a section, related information, chains.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { computeECMALineStarts, computeLineOfPosition } from "./diagnosticwriter";
import { isDefaultLibraryFile } from "./error_baseline";
import { BaselineReadError, type ParsedDiagnostic, readErrorBaseline } from "./reader";

const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const list = (dir: string): string[] => readdirSync(dir).filter(f => f.endsWith(".errors.txt")).sort().map(f => join(dir, f));
for (const [label, files] of [
  ["go", [...list(join(GO, "compiler")), ...list(join(GO, "conformance"))]],
  ["ts", list(TS)],
] as [string, string[]][]) {
  const c: Record<string, number> = {};
  const ex: Record<string, Set<string>> = {};
  const bump = (k: string, f: string, n = 1) => {
    c[k] = (c[k] ?? 0) + n;
    (ex[k] ??= new Set()).add(basename(f));
  };
  for (const f of files) {
    const text = readFileSync(f).toString("latin1");
    let parsed;
    try {
      parsed = readErrorBaseline(text, { rules: "tsgo" });
    } catch (e) {
      if (!(e instanceof BaselineReadError)) throw e;
      parsed = readErrorBaseline(text, { rules: "tsc" });
    }
    bump("baselines", f);
    bump("sections", f, parsed.files.length);
    const names = parsed.files.map(x => x.unitName);
    const lower = names.map(n => n.toLowerCase());
    if (new Set(names).size !== names.length) bump("baselines with two sections of one name", f);
    else if (new Set(lower).size !== lower.length) bump("baselines with sections that differ in case only", f);
    const perLine = new Map<string, number>();
    for (const d of parsed.diagnostics) {
      bump("diagnostics", f);
      bump("category " + d.category, f);
      if (d.messageChain.length > 0) bump("diagnostics with a chain", f);
      if (d.message.includes("\n")) bump("diagnostics with a line break in the message", f);
      const depth = (x: ParsedDiagnostic): number => 1 + Math.max(0, ...x.messageChain.map(depth));
      if (depth(d) > 8) bump("chains deeper than 8", f);
      if (d.messageChain.length > 1 || d.messageChain.some(function many(x: ParsedDiagnostic): boolean { return x.messageChain.length > 1 || x.messageChain.some(many); })) bump("chains with siblings", f);
      if (d.relatedInformation.length > 0) bump("diagnostics with related information", f);
      for (const r of d.relatedInformation) {
        bump("related entries", f);
        if (r.file === undefined) bump("related without a file", f);
        else if (!r.file.hasText) bump(isDefaultLibraryFile(r.file.fileName) ? "related in a library file (no section)" : "related in another file without a section", f);
        if (r.file !== undefined && r.line === undefined) bump("related with a masked position", f);
        if (r.messageChain.length > 0) bump("related with a chain", f);
      }
      if (d.file === undefined) {
        bump("global diagnostics", f);
        continue;
      }
      if (!d.file.hasText) {
        bump(isDefaultLibraryFile(d.file.fileName) ? "diagnostics in a library file (no section)" : "diagnostics in another file without a section", f);
        if (d.line === undefined) bump("diagnostics with a masked position", f);
        continue;
      }
      if (d.end === d.pos) bump("spans of length 0", f);
      const starts = computeECMALineStarts(d.file.text);
      const l0 = computeLineOfPosition(starts, d.pos);
      const l1 = computeLineOfPosition(starts, d.end);
      if (l1 !== l0) bump("spans over several lines", f);
      if (l1 - l0 >= 4) bump("spans over five lines or more", f);
      if (d.end === d.file.text.length) bump("spans that end at the end of the text", f);
      if (d.pos === d.file.text.length) bump("spans that start at the end of the text", f);
      const lineEnd = l0 + 1 < starts.length ? starts[l0 + 1] - 1 : d.file.text.length;
      if (d.pos === lineEnd && d.end === d.pos) bump("spans of length 0 at the end of a line", f);
      if (l1 !== l0 && d.end === starts[l1]) bump("spans that end at the start of a line", f);
      const key = d.file.fileName + ":" + l0;
      perLine.set(key, (perLine.get(key) ?? 0) + 1);
      if (/[\x80-\xff]/.test(d.file.text.slice(starts[l0], d.end))) bump("spans with bytes over 0x7f before or inside", f);
      if (/[\t]/.test(d.file.text.slice(starts[l0], d.pos))) bump("spans with a tab before", f);
      if (/[\x0b\x0c]|\xc2\xa0/.test(d.file.text.slice(starts[l0], d.pos))) bump("spans with VT, FF or NBSP before", f);
    }
    for (const n of perLine.values()) if (n > 1) bump("lines where several spans start", f);
  }
  console.log(`== ${label}`);
  for (const k of Object.keys(c).sort()) console.log(`  ${k}: ${c[k]} in ${ex[k].size} baselines${ex[k].size <= 6 ? " (" + [...ex[k]].join(", ") + ")" : ""}`);
}
