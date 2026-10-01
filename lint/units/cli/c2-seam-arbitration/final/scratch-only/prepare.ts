// Makes line-based vectors for the Rust probe from the fuzz vectors of the conformance unit.
// The expected text is what the TS port of the reference's writer prints (checked against the Go code by that unit).
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const P = "/workspace/notes/lint/units/conformance/error-baseline-format/prototype";
const { compareDiagnostics, writeFormatDiagnostics, Writer } = await import(P + "/diagnosticwriter.ts");
const V = "/workspace/notes/lint/units/conformance/error-baseline-format/vectors";
const lines = [
  ...gunzipSync(readFileSync(V + "/writer-vectors.jsonl.gz")).toString("utf8").split("\n"),
  ...readFileSync(V + "/examples-vectors.jsonl", "utf8").split("\n"),
].filter(l => l.length > 0);
const lat = (b64: string): string => Buffer.from(b64, "base64").toString("latin1");
const hex = (s: string): string => (s.length === 0 ? "-" : Buffer.from(s, "latin1").toString("hex"));
const oneLine = (s: string): string => s.replace(/\r\n|\r|\n/g, " ");
let out = "";
let used = 0, skipped = 0, diags = 0;
for (const line of lines) {
  const v = JSON.parse(line);
  if (v.pretty) { skipped++; continue; }
  const files = v.files.map((f: any) => ({ fileName: lat(f.name), text: lat(f.text) }));
  const conv = (d: any): any => ({
    file: d.file < 0 ? undefined : files[d.file],
    fileIndex: d.file,
    pos: d.pos, end: d.end, code: d.code, category: d.category, source: d.source,
    message: oneLine(lat(d.message)),
    messageChain: d.chain.map(conv),
    relatedInformation: [],
  });
  const ds = v.diagnostics.map(conv);
  if (ds.some((d: any) => d.source !== "" || d.code < 0 || d.end < d.pos || d.pos < 0)) { skipped++; continue; }
  used++; diags += ds.length;
  const sorted = [...ds].sort(compareDiagnostics);
  const w = new Writer();
  writeFormatDiagnostics(w, sorted, { newLine: "\r\n", currentDirectory: "", useCaseSensitiveFileNames: false });
  out += `V ${hex(v.name)}\n`;
  for (const f of files) out += `F ${hex(f.fileName)} ${hex(f.text)}\n`;
  const chain = (c: any[], level: number) => { for (const n of c) { out += `C ${level} ${hex(n.message)}\n`; chain(n.messageChain, level + 1); } };
  for (const d of ds) {
    out += `D ${d.fileIndex} ${d.pos} ${d.end - d.pos} ${d.code} ${d.category} ${hex(d.message)}\n`;
    chain(d.messageChain, 1);
  }
  out += `X ${hex(w.toString())}\n`;
}
writeFileSync("/tmp/c2probe/vec/vectors.txt", out);
console.log({ vectors: lines.length, used, skipped, diags, bytes: out.length });
