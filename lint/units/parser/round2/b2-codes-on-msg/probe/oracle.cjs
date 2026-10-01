const fs = require("fs");
const cp = require("child_process");
const ts = require("/workspace/wt/parser/node_modules/typescript");
const inputs = JSON.parse(fs.readFileSync(process.argv[2] || "inputs.json", "utf8"));
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const byteOff = (s, u16) => Buffer.byteLength(s.slice(0, u16), "utf8");
const goIn = inputs.map(([k, s], i) => JSON.stringify({ id: i, name: "input." + k, src: s })).join("\n") + "\n";
const goOut = cp.execFileSync(process.env.TSGO_PARSEDIAG || "/tmp/rr/parsediag-bu", [], { input: goIn, maxBuffer: 1 << 28 }).toString().split("\n").filter(Boolean).map(l => JSON.parse(l));
inputs.forEach(([k, s], i) => {
  const sf = ts.createSourceFile("input." + k, s, ts.ScriptTarget.Latest, false, kinds[k]);
  console.log(JSON.stringify(s), `[${k}]`);
  const d = sf.parseDiagnostics.slice(0, 3).map(d => { const a = byteOff(s, d.start), b = byteOff(s, d.start + d.length); return `@${a}+${b - a} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`; });
  console.log("   tsc  " + (d.length ? d.join(" | ") : "parses"));
  const g = goOut[i];
  const gd = (g.diags || []).slice(0, 3).map(r => `@${r[1]}+${r[2]} TS${r[0]} ${r[5]}`);
  console.log("   tsgo " + (g.panic ? "PANIC " + g.panic : gd.length ? gd.join(" | ") : "parses"));
});
