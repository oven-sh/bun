// Counts over the parsed corpus: kinds of spans and of source lines.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeLineOfPosition, tscRules, tsgoRules } from "./diagnosticwriter";
import { readErrorBaseline } from "./reader";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
for (const [tag, rules, dirs] of [["go", tsgoRules, [join(GO, "compiler"), join(GO, "conformance")]], ["ts", tscRules, [TS]]] as const) {
  const c: Record<string, number> = {};
  const ex: Record<string, string[]> = {};
  const bump = (k: string, f: string, n = 1) => { c[k] = (c[k] ?? 0) + n; (ex[k] ??= []).length < 4 && !ex[k].includes(f) && ex[k].push(f); };
  for (const dir of dirs) for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".errors.txt")) continue;
    const name = f.replace(".errors.txt", "");
    const p = readErrorBaseline(rules, rules.model.fromBytes(readFileSync(join(dir, f))));
    bump("baselines", name);
    bump("files", name, p.files.length);
    bump("diagnostics", name, p.diagnostics.length);
    for (const file of p.files) {
      const lines = rules.model.splitLines(file.content);
      const starts = rules.model.lineStarts(file.content);
      if (starts.length !== lines.length) bump("file with more line starts than lines", name);
      for (const l of lines) {
        if (/^\s*~+$/.test(l)) bump("source line of white space and tildes", name);
        else if (/^\s*$/.test(l)) bump("source line of white space or empty", name);
      }
      if (/[^\x00-\x7f]/.test(file.content)) bump("file with text outside ASCII", name);
    }
    const perLine = new Map<string, number>();
    for (const d of p.diagnostics) {
      bump("category " + d.category, name);
      if (d.file === undefined) { bump("diagnostic without file", name); continue; }
      const inInput = p.files.some(x => x.content === d.file!.text);
      if (!inInput) { bump("diagnostic in a file without section", name); continue; }
      const starts = d.file.lineMap!;
      const l0 = computeLineOfPosition(starts, d.pos), l1 = computeLineOfPosition(starts, d.end);
      if (d.end === d.pos) bump("span of length 0", name);
      if (d.end === d.file.text.length) bump("span that ends at the end of the text", name);
      if (d.pos === d.file.text.length) bump("span that starts at the end of the text", name);
      if (l1 > l0) bump("span over several lines", name);
      if (l1 - l0 >= 4) bump("span over five lines or more", name);
      if (l1 > l0 && d.end === starts[l1]) bump("span that ends at the start of a line", name);
      const lineEnd = l0 + 1 < starts.length ? starts[l0 + 1] - 1 : d.file.text.length;
      if (d.pos === lineEnd && d.end > d.pos) bump("span that starts at the line break", name);
      const key = d.file.fileName + ":" + l0;
      perLine.set(key, (perLine.get(key) ?? 0) + 1);
      if (d.messageChain.length > 0) bump("diagnostic with a chain", name);
      if (d.messageChain.length > 1) bump("diagnostic with two chains at level 1", name);
      if (d.relatedInformation.length > 0) bump("diagnostic with related information", name);
      for (const r of d.relatedInformation) {
        if (r.file === undefined) bump("related information without file", name);
        if (r.messageChain.length > 0) bump("related information with a chain", name);
      }
      const text = d.file.text.slice(starts[l0], d.pos);
      if (/[^\x00-\x7f]/.test(text)) bump("text outside ASCII before the span on its line", name);
      if (/[^\x00-\x7f]/.test(d.file.text.slice(d.pos, d.end))) bump("text outside ASCII inside the span", name);
      if (/\t/.test(text)) bump("tab before the span on its line", name);
    }
    for (const n of perLine.values()) if (n > 1) bump("line where several spans start", name);
  }
  console.log("== " + tag);
  for (const k of Object.keys(c).sort()) console.log(`  ${String(c[k]).padStart(7)}  ${k}   e.g. ${ex[k].join(", ")}`);
}
