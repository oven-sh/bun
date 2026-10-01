// usage: <bun> probe.cjs <inputs.json> [--go /tmp/rr/parsediag-bu]
// For each input prints the parse diagnostics of tsc 6.0.2 (createSourceFile().parseDiagnostics), the grammar errors
// that its checker adds (noLib program, codes 1000-1999, 2880, 8000-8999, 17000-18999), the parse diagnostics of
// typescript-go 89d5d5b when --go names the oracle of ledger/bottom-up/tsgo-oracle, and what the running bun does
// with it: scanImports (the parse pass alone) and transformSync (parse and visit).
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const goAt = process.argv.indexOf("--go");
const goBin = goAt > 0 ? process.argv[goAt + 1] : null;
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const nameOf = l => (l === "dts" ? "input.d.ts" : "input." + l);
let go = new Map();
if (goBin) {
  const lines = inputs.map((r, id) => JSON.stringify({ id, name: nameOf(r.l || "ts"), src: r.s })).join("\n") + "\n";
  const p = spawnSync(goBin, [], { input: lines, maxBuffer: 1 << 28 });
  for (const line of String(p.stdout).split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    go.set(r.id, r);
  }
}
const isGrammar = c => (c >= 1000 && c < 2000) || c === 2880 || (c >= 8000 && c < 9000) || (c >= 17000 && c < 19000);
let group = null;
inputs.forEach((r, id) => {
  const l = r.l || "ts";
  if (r.g && r.g !== group) { group = r.g; console.log("## " + group); }
  console.log(JSON.stringify(r.s), "[" + l + "]");
  const kl = l === "dts" ? "ts" : l;
  const name = nameOf(l);
  const sf = ts.createSourceFile(name, r.s, ts.ScriptTarget.Latest, false, kinds[kl]);
  for (const d of sf.parseDiagnostics.slice(0, 4)) console.log(`   tsc @${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  if (!sf.parseDiagnostics.length) {
    const host = ts.createCompilerHost({});
    host.getSourceFile = (f, v) => (f === name ? ts.createSourceFile(name, r.s, ts.ScriptTarget.Latest, true, kinds[kl]) : undefined);
    host.fileExists = f => f === name;
    host.readFile = f => (f === name ? r.s : undefined);
    const program = ts.createProgram([name], { noLib: true, noResolve: true, allowJs: true, checkJs: false, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, types: [], jsx: ts.JsxEmit.Preserve, experimentalDecorators: false, noEmit: true }, host);
    const file = program.getSourceFile(name);
    const all = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)].filter(d => isGrammar(d.code));
    if (!all.length) console.log("   tsc parses");
    for (const d of all.slice(0, 3)) console.log(`   tsc parses; checker @${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  }
  const g = go.get(id);
  if (g) {
    if (g.panic) console.log("   go  PANIC " + g.panic.slice(0, 100));
    for (const d of (g.diags || []).slice(0, 4)) console.log(`   go  @${d[1]}+${d[2]} TS${d[0]} ${d[5]}`);
    if (!g.panic && !(g.diags || []).length) console.log("   go  parses");
  }
  if (typeof Bun !== "undefined") {
    const fmt = e => (e?.errors ?? [e]).map(x => `@${x.position?.offset ?? "?"}+${x.position?.length ?? "?"} ${x.message}`);
    let scan = [], full = [];
    try { new Bun.Transpiler({ loader: kl }).scanImports(r.s); } catch (e) { scan = fmt(e); }
    try { new Bun.Transpiler({ loader: kl }).transformSync(r.s); } catch (e) { full = fmt(e); }
    if (!full.length) console.log("   bun accepts");
    else if (!scan.length) for (const b of full.slice(0, 2)) console.log("   bun visit " + b);
    else for (const b of scan.slice(0, 3)) console.log("   bun " + b);
  }
});
