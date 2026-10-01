// usage: <bun> probe.cjs <inputs.json> [--go /tmp/rr/parsediag-bu]
// inputs.json: an array of strings or of [loader, text] (loader: ts tsx js jsx) or of {g: "group"} headings.
// For each input prints, on one block: the first two parse diagnostics of typescript-go 89d5d5b (when --go is given),
// whether tsc 6.0.2 agrees on the first one, and what the running bun does: scanImports (parse pass alone) and
// transformSync (parse and visit).
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const goAt = process.argv.indexOf("--go");
const goBin = goAt > 0 ? process.argv[goAt + 1] : null;
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const inputs = raw.map(r => (typeof r === "string" ? { l: "ts", s: r } : Array.isArray(r) ? { l: r[0], s: r[1] } : r));
let go = new Map();
if (goBin) {
  const lines = inputs.map((r, id) => (r.s === undefined ? null : JSON.stringify({ id, name: "input." + r.l, src: r.s }))).filter(Boolean).join("\n") + "\n";
  const p = spawnSync(goBin, [], { input: lines, maxBuffer: 1 << 28 });
  for (const line of String(p.stdout).split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    go.set(r.id, r);
  }
}
inputs.forEach((r, id) => {
  if (r.g) { console.log("## " + r.g); return; }
  const sf = ts.createSourceFile("input." + r.l, r.s, ts.ScriptTarget.Latest, false, kinds[r.l]);
  const td = sf.parseDiagnostics.map(d => [d.code, d.start, d.length, ts.flattenDiagnosticMessageText(d.messageText, "\n")]);
  const g = go.get(id);
  const gd = g ? (g.diags || []).map(d => [d[0], d[1], d[2], d[5]]) : null;
  const show = d => `TS${d[0]}@${d[1]}+${d[2]} ${JSON.stringify(d[3])} <<${r.s.slice(d[1], d[1] + d[2])}>>`;
  const ref = gd || td;
  let line = `${JSON.stringify(r.s)} [${r.l}]\n    ${gd ? "go " : "tsc"}: ${ref.length ? ref.slice(0, 2).map(show).join(" | ") : "(parses)"}`;
  if (gd) {
    const same = JSON.stringify(gd[0] || null) === JSON.stringify(td[0] || null);
    line += same ? "   [tsc first: same]" : `\n    tsc: ${td.length ? td.slice(0, 2).map(show).join(" | ") : "(parses)"}   [DIFFERS]`;
    if (g.panic) line += "\n    go PANIC " + g.panic.slice(0, 80);
  }
  if (typeof Bun !== "undefined") {
    const fmt = e => (e?.errors ?? [e]).map(x => `@${x.position?.offset ?? "?"}+${x.position?.length ?? "?"} ${x.message}`);
    let scan = [], full = [], out = "";
    try { new Bun.Transpiler({ loader: r.l }).scanImports(r.s); } catch (e) { scan = fmt(e); }
    try { out = new Bun.Transpiler({ loader: r.l }).transformSync(r.s); } catch (e) { full = fmt(e); }
    line += "\n    bun: " + (scan.length ? "parse ERR " + scan[0] : full.length ? "parse ok, visit ERR " + full[0] : "accepts => " + JSON.stringify(out.slice(0, 70)));
  }
  console.log(line);
});
