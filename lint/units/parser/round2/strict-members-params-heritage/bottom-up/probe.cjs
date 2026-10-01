// usage: <bun under test> probe.cjs <inputs.json> [--go /tmp/rr/parsediag-bu] [--lint <tsv of zz_probe.rs>] [--hex <out>]
// For each input prints: the parse diagnostics of tsc 6.0.2; where it has none, the diagnostics of its checker in a
// program without lib (grammar codes in full, the others as numbers); the parse diagnostics of typescript-go 89d5d5b
// (--go, the oracle of ledger/bottom-up/tsgo-oracle); what a parse without lint of the running bun does (scanImports =
// the parse pass alone with experimental decorators, transformSync = parse and visit); and, with --lint, what a lint
// parse does (the output of zz_probe.rs for the file that --hex wrote in an earlier run).
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const opt = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const goBin = opt("--go"), lintFile = opt("--lint"), hexOut = opt("--hex");
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const nameOf = l => (l === "dts" ? "input.d.ts" : "input." + l);
if (hexOut) {
  fs.writeFileSync(hexOut, inputs.map((r, id) => `${id} ${r.l || "ts"} ${Buffer.from(r.s, "utf8").toString("hex")}`).join("\n") + "\n");
}
const go = new Map();
if (goBin) {
  const lines = inputs.map((r, id) => JSON.stringify({ id, name: nameOf(r.l || "ts"), src: r.s })).join("\n") + "\n";
  const p = spawnSync(goBin, [], { input: lines, maxBuffer: 1 << 28 });
  for (const line of String(p.stdout).split("\n")) { if (line) { const r = JSON.parse(line); go.set(r.id, r); } }
}
const lint = new Map();
if (lintFile) {
  for (const line of fs.readFileSync(lintFile, "utf8").split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    lint.set(Number(f[0]), f);
  }
}
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
const isGrammar = c => (c >= 1000 && c < 2000) || c === 2880 || (c >= 8000 && c < 9000) || (c >= 17000 && c < 19000);
let group = null;
inputs.forEach((r, id) => {
  const l = r.l || "ts";
  if (r.g && r.g !== group) { group = r.g; console.log("## " + group); }
  console.log(JSON.stringify(r.s), "[" + l + "]");
  const kl = l === "dts" ? "ts" : l;
  const name = nameOf(l);
  const sf = ts.createSourceFile(name, r.s, ts.ScriptTarget.Latest, false, kinds[kl]);
  for (const d of sf.parseDiagnostics.slice(0, 3)) console.log(`   tsc @${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  if (!sf.parseDiagnostics.length) {
    const host = ts.createCompilerHost({});
    host.getSourceFile = f => (f === name ? ts.createSourceFile(name, r.s, ts.ScriptTarget.Latest, true, kinds[kl]) : undefined);
    host.fileExists = f => f === name;
    host.readFile = f => (f === name ? r.s : undefined);
    const program = ts.createProgram([name], { noLib: true, noResolve: true, allowJs: true, checkJs: false, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, types: [], jsx: ts.JsxEmit.Preserve, experimentalDecorators: false, noEmit: true, strict: false }, host);
    const file = program.getSourceFile(name);
    const all = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)];
    const grammar = all.filter(d => isGrammar(d.code));
    const others = [...new Set(all.filter(d => !isGrammar(d.code)).map(d => d.code))].filter(c => ![2304, 2318, 2339, 2503, 2552, 2580, 2583, 2584, 2693, 2694, 7006, 7008, 7010, 7031, 2300, 2451, 2391, 2393, 2394, 2322, 2355, 2378, 2564, 2307, 2792].includes(c));
    if (!grammar.length) console.log("   tsc parses" + (others.length ? "; checker also TS" + others.slice(0, 6).join(" TS") : ""));
    for (const d of grammar.slice(0, 3)) console.log(`   tsc parses; checker @${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    if (grammar.length && others.length) console.log("   tsc checker also TS" + others.slice(0, 6).join(" TS"));
  }
  const g = go.get(id);
  if (g) {
    if (g.panic) console.log("   go  PANIC " + g.panic.slice(0, 100));
    for (const d of (g.diags || []).slice(0, 3)) console.log(`   go  @${d[1]}+${d[2]} TS${d[0]} ${d[5]}`);
    if (!g.panic && !(g.diags || []).length) console.log("   go  parses");
  }
  if (typeof Bun !== "undefined") {
    const fmt = e => (e?.errors ?? [e]).map(x => `@${x.position?.offset ?? "?"}+${x.position?.length ?? "?"} ${x.message}`);
    let scan = [], full = [];
    try { new Bun.Transpiler({ loader: kl }).scanImports(r.s); } catch (e) { scan = fmt(e); }
    try { new Bun.Transpiler({ loader: kl }).transformSync(r.s); } catch (e) { full = fmt(e); }
    if (!full.length && !scan.length) console.log("   bun accepts");
    else if (!scan.length) for (const b of full.slice(0, 2)) console.log("   bun scan accepts; transform " + b);
    else { for (const b of scan.slice(0, 2)) console.log("   bun " + b); if (!full.length) console.log("   bun transform accepts"); }
  }
  const f = lint.get(id);
  if (f) {
    if (f[1] === "ok") console.log("   lint parses");
    else if (f[1] === "panic") console.log("   lint PANIC");
    else console.log(`   lint ${f[1] === "init" ? "(init) " : ""}@${f[2]}+${f[3]} ${unhex(f[8])}` + (f[4] !== "0" ? `  => TS${f[4]} @${f[5]}+${f[6] - f[5]} ${unhex(f[9])}` : "  => no code") + (Number(f[7]) > 1 ? `  (${f[7]} messages)` : ""));
  }
});
