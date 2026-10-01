// usage: <release bun of the tree> probe.cjs <inputs.json> [--only CLASSES] [--group PREFIX] [--all]
// One line per input: what typescript-go 89d5d5b reports first (its parser), what tsc 6.0.2 reports first (its parser,
// else the grammar errors of its checker), what a lint parse of the tree does (the probe binary of zz_probe.rs), and
// what a parse without lint does (scanImports of the bun that runs this script: the parse pass alone).
// Class of a line, the reference being typescript-go's parser:
//   ok  both take the source          A   the reference rejects, the lint parse takes it
//   D   the reference takes it, the lint parse rejects it
//   =   both reject: same code, same start, same end      ~  same code, another range      !  another code, or none
// "GO/TSC" marks a line where tsc's parser reports another first diagnostic than typescript-go's.
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const GO = process.env.PARSEDIAG || "/tmp/rr/parsediag-bu";
const LINT = process.env.LINTPROBE || "/tmp/smph/out/bun_js_parser";
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const arg = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
const groupPrefix = arg("--group");
const showAll = process.argv.includes("--all");
const nameOf = l => (l === "dts" ? "input.d.ts" : "input." + l);
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };

// typescript-go
const go = new Map();
{
  const lines = inputs.map((r, id) => JSON.stringify({ id, name: nameOf(r.l || "ts"), src: r.s })).join("\n") + "\n";
  const p = spawnSync(GO, [], { input: lines, maxBuffer: 1 << 28 });
  for (const line of String(p.stdout).split("\n")) if (line) { const r = JSON.parse(line); go.set(r.id, r); }
}
// the lint parse of the tree
const lint = new Map();
{
  const tmp = fs.mkdtempSync("/tmp/b4d-");
  fs.writeFileSync(tmp + "/in.hex", inputs.map((r, id) => `${id} ${r.l || "ts"} ${Buffer.from(r.s, "utf8").toString("hex")}`).join("\n") + "\n");
  const env = { ...process.env, SMPH_INPUTS: tmp + "/in.hex", SMPH_OUT: tmp + "/out.tsv" };
  if (process.env.TLA !== "0") env.SMPH_TLA = "1";
  spawnSync(LINT, ["zz_probe"], { env, stdio: "ignore" });
  for (const line of fs.readFileSync(tmp + "/out.tsv", "utf8").split("\n")) if (line) { const f = line.split("\t"); lint.set(Number(f[0]), f); }
  fs.rmSync(tmp, { recursive: true, force: true });
}
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
const isGrammar = c => (c >= 1000 && c < 2000) || c === 2880 || (c >= 17000 && c < 19000) || [2369, 2371, 2730, 2680, 2784, 2809, 2754, 2452, 2462, 2523, 2524, 2699, 2300].includes(c);
const counts = {};
let group = null;
inputs.forEach((r, id) => {
  const l = r.l || "ts";
  if (groupPrefix && !String(r.g).startsWith(groupPrefix)) return;
  const kl = l === "dts" ? "ts" : l;
  const name = nameOf(l);
  // tsc
  const sf = ts.createSourceFile(name, r.s, ts.ScriptTarget.Latest, false, kinds[kl]);
  const tscParse = sf.parseDiagnostics.map(d => [d.code, d.start, d.length, ts.flattenDiagnosticMessageText(d.messageText, "\n")]);
  let tscCheck = [];
  if (!tscParse.length) {
    const host = ts.createCompilerHost({});
    host.getSourceFile = f => (f === name ? ts.createSourceFile(name, r.s, ts.ScriptTarget.Latest, true, kinds[kl]) : undefined);
    host.fileExists = f => f === name;
    host.readFile = f => (f === name ? r.s : undefined);
    const program = ts.createProgram([name], { noLib: true, noResolve: true, allowJs: true, checkJs: false, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, types: [], jsx: ts.JsxEmit.Preserve, experimentalDecorators: !!r.exp, noEmit: true, strict: false }, host);
    const file = program.getSourceFile(name);
    tscCheck = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]
      .filter(d => isGrammar(d.code))
      .map(d => [d.code, d.start, d.length, ts.flattenDiagnosticMessageText(d.messageText, "\n")]);
  }
  const g = go.get(id) || { diags: [], panic: "missing" };
  const goDiags = g.diags || [];
  const f = lint.get(id) || [id, "missing"];
  const lintOk = f[1] === "ok";
  const lintCode = lintOk ? 0 : Number(f[4] || 0);
  const lintStart = lintCode ? Number(f[5]) : Number(f[2]);
  const lintEnd = lintCode ? Number(f[6]) : Number(f[2]) + Number(f[3]);
  let cls;
  if (f[1] === "panic" || f[1] === "missing") cls = "PANIC";
  else if (goDiags.length) {
    const d = goDiags[0];
    if (lintOk) cls = "A";
    else if (lintCode === d[0]) cls = lintStart === d[1] && lintEnd === d[1] + d[2] ? "=" : "~";
    else cls = "!";
  } else cls = lintOk ? "ok" : "D";
  counts[cls] = (counts[cls] || 0) + 1;
  if (only && !only.has(cls)) return;
  if (!only && !showAll && false) return;
  if (r.g && r.g !== group) { group = r.g; console.log("## " + group); }
  const fmt = d => `TS${d[0]}@${d[1]}+${d[2]}`;
  const goShown = g.panic ? "PANIC " + String(g.panic).slice(0, 60) : goDiags.length ? goDiags.slice(0, 3).map(fmt).join(" ") + ` "${goDiags[0][5]}"` : "parses";
  let tscShown;
  if (tscParse.length) tscShown = tscParse.slice(0, 2).map(fmt).join(" ");
  else if (tscCheck.length) tscShown = "parses; checker " + tscCheck.slice(0, 2).map(d => fmt(d) + ` "${d[3].slice(0, 70)}"`).join(" ");
  else tscShown = "parses";
  const differs = goDiags.length ? !(tscParse.length && tscParse[0][0] === goDiags[0][0] && tscParse[0][1] === goDiags[0][3] && tscParse[0][2] === goDiags[0][4]) : tscParse.length > 0;
  const lintShown = lintOk ? "parses" : f[1] === "panic" ? "PANIC" : f[1] === "missing" ? "MISSING" :
    (f[1] === "init" ? "(init) " : "") + (lintCode ? `TS${lintCode}@${lintStart}+${lintEnd - lintStart}` : "nocode") + ` [@${f[2]}+${f[3]} ${unhex(f[8])}]` + (Number(f[7]) > 1 ? ` (${f[7]} msgs)` : "");
  let plain = "";
  if (typeof Bun !== "undefined") {
    let scan = null;
    try { new Bun.Transpiler({ loader: kl }).scanImports(r.s); } catch (e) { const x = (e?.errors ?? [e])[0]; scan = `@${x?.position?.offset ?? "?"}+${x?.position?.length ?? "?"} ${x?.message}`; }
    plain = "  || plain: " + (scan === null ? "parses" : "rejects [" + scan + "]");
  }
  console.log(`${cls.padEnd(3)}${differs ? "GO/TSC " : ""}${l === "ts" ? "" : "[" + l + "] "}${r.n ? "(" + r.n + ") " : ""}${JSON.stringify(r.s)}  || go: ${goShown}  || tsc: ${tscShown}  || lint: ${lintShown}${plain}`);
});
console.log("# counts " + JSON.stringify(counts));
