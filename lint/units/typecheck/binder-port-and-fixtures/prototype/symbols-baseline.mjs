// Reads a .symbols baseline of the reference: the result lines of one unit with the source line they follow.
import fs from "node:fs";
const codeLinesRegexp = /[\r\u2028\u2029]|\r?\n/;
const optionRegex = /^\/{2}\s*@(\w+)\s*:\s*([^\r\n]*)/;
export function unitContent(code) {
  let out = "";
  for (const line of code.split(/\r?\n/)) {
    if (optionRegex.test(line)) continue;
    if (out.length !== 0) out += "\n";
    out += line;
  }
  return out;
}
export function parseSymbolsBaseline(content, unit, source) {
  const marker = "=== " + unit + " ===\r\n";
  const at = content.indexOf(marker);
  if (at < 0) return { ok: false, why: "no unit header", lines: [] };
  let body = content.slice(at + marker.length);
  const next = body.indexOf("\r\n=== ");
  if (next >= 0) body = body.slice(0, next);
  const codeLines = source.split(codeLinesRegexp);
  const lines = [];
  let src = 0;
  const parts = body.split("\r\n");
  for (let i = 0; i < parts.length; i++) {
    const l = parts[i];
    const sep = l.startsWith(">") ? l.indexOf(" : Symbol(") : -1;
    if (sep >= 0 && src > 0 && !(src < codeLines.length && l === codeLines[src])) {
      lines.push({ line: src - 1, text: l.slice(1, sep), symbol: l.slice(sep + 3), at: i });
      continue;
    }
    if (src < codeLines.length && l === codeLines[src]) { src++; continue; }
    if (l === "") continue;
    return { ok: false, why: `line ${i}: ${JSON.stringify(l)} expected ${JSON.stringify(codeLines[src])}`, lines };
  }
  return { ok: true, lines, codeLines: codeLines.length, consumed: src };
}
if (import.meta.main) {
  const [casePath, baselinePath] = process.argv.slice(2);
  const source = unitContent(fs.readFileSync(casePath, "utf8").replace(/^\uFEFF/, ""));
  const unit = casePath.split("/").pop();
  const r = parseSymbolsBaseline(fs.readFileSync(baselinePath, "utf8"), unit, source);
  console.log(r.ok, r.why ?? "", r.lines.length, r.codeLines, r.consumed);
  for (const l of r.lines.slice(0, Number(process.argv[4] ?? 40))) console.log(l.line, JSON.stringify(l.text), l.symbol);
}
