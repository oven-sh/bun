// usage: <bun under test> bunrun.mjs <inputs.jsonl> <out.jsonl> [first index]
// For each input what a parse without lint does: scanImports (the parse pass alone) and transformSync (parse and
// visit). One line each: {i, scan: null | [offset, length, message], full: null | [offset, length, message]}.
import { readFileSync, appendFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const from = Number(process.argv[4] || 0);
const ts = new Bun.Transpiler({ loader: "ts" });
const fmt = e => {
  const x = (e?.errors ?? [e])[0];
  return [x?.position?.offset ?? -1, x?.position?.length ?? -1, String(x?.message ?? x)];
};
let buf = "";
for (const line of lines) {
  const r = JSON.parse(line);
  if (r.i < from) continue;
  let scan = null, full = null;
  try { ts.scanImports(r.s); } catch (e) { scan = fmt(e); }
  try { ts.transformSync(r.s); } catch (e) { full = fmt(e); }
  buf += JSON.stringify({ i: r.i, scan, full }) + "\n";
  if (r.i % 2000 === 0) { appendFileSync(process.argv[3], buf); buf = ""; }
}
appendFileSync(process.argv[3], buf);
