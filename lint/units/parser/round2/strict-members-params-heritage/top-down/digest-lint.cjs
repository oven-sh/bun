// usage: <bun under test> digest-lint.cjs <inputs.json> <lint.txt of lintprobe> [--only A,B!,...] [--group PREFIX]
// One line per input: class, source, first diagnostic of tsc 6.0.2 (parser, else checker), what the lint parse of the
// tree does (first entry: code start end, or nocode + bun's message), and "plain:" what a parse without lint does
// when that differs in accepting.
//   A  the reference's parser rejects, the lint parse accepts
//   B= both reject, same code and same start   B~ same code, other start   B! other code or no code
//   C  the reference's parser accepts and its checker reports, the lint parse accepts
//   D  the reference's parser accepts and its checker reports, the lint parse rejects
//   E  tsc reports nothing (of the codes counted), the lint parse rejects
//   F  tsc reports nothing, the lint parse accepts
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("node:fs");
const path = require("node:path");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const lint = fs.readFileSync(process.argv[3], "utf8").split("\n").filter(Boolean).map(line => line.split("\t"));
const arg = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
const groupPrefix = arg("--group");
// Not counted: what a missing lib or a missing declaration gives, and implicit any.
const NOISE = new Set([2304, 2318, 2307, 2503, 2552, 2580, 2583, 2584, 2591, 2688, 2792, 2339, 2322, 2345, 2355, 2378, 2507, 2711, 2697, 2705, 1064, 2468, 2354, 2807, 2343, 2538, 2536, 2532, 2531, 2533, 2564, 2454, 2365, 2362, 2363, 2367, 2695, 2872, 2873, 2774, 2801, 2877, 2878, 2741, 2739, 2740, 2551, 2349, 2351, 2693, 2749, 2709, 2315, 2314, 2344, 2558, 2554, 2555, 2556, 2559, 2560, 2571, 2769, 2350, 2348, 2347, 2346, 2794, 6133, 6196, 6192, 6198, 6138, 2306, 2305, 2614, 2613, 1192, 2459, 2460, 1259, 2497, 2732, 2440, 2395, 2686, 2708, 2702, 2713, 2749, 2636, 2637, 2638]);
const isCounted = code => !NOISE.has(code) && !(code >= 7000 && code < 7060);
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const nameOf = l => (l === "dts" ? "input.d.ts" : "input." + l);
const counts = {};
let group = null;
inputs.forEach((r, id) => {
  const l = r.l || "ts";
  if (groupPrefix && !String(r.g).startsWith(groupPrefix)) return;
  const kl = l === "dts" ? "ts" : l;
  const name = nameOf(l);
  const sf = ts.createSourceFile(name, r.s, ts.ScriptTarget.Latest, false, kinds[kl]);
  const parse = sf.parseDiagnostics.map(d => ({ code: d.code, start: d.start, length: d.length, text: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
  let check = [];
  if (!parse.length) {
    const host = ts.createCompilerHost({});
    host.getSourceFile = f => (f === name ? ts.createSourceFile(name, r.s, ts.ScriptTarget.Latest, true, kinds[kl]) : undefined);
    host.fileExists = f => f === name;
    host.readFile = f => (f === name ? r.s : undefined);
    const program = ts.createProgram([name], { noLib: true, noResolve: true, allowJs: true, checkJs: false, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, types: [], jsx: ts.JsxEmit.Preserve, experimentalDecorators: !!r.exp, noEmit: true, strict: true }, host);
    const file = program.getSourceFile(name);
    check = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]
      .filter(d => isCounted(d.code))
      .map(d => ({ code: d.code, start: d.start, length: d.length, text: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
  }
  const row = lint[id] || [];
  const lintOk = row[1] === "OK";
  // First message: "TS1005 18 18 'text' || @18+0 bun text" or "nocode || @..".
  let lintCode = null, lintStart = null, lintEnd = null, lintText = "";
  if (!lintOk && row[2]) {
    const m = /^TS(\d+) (\d+) (\d+) '(.*)' \|\| (.*)$/s.exec(row[2]);
    if (m) { lintCode = +m[1]; lintStart = +m[2]; lintEnd = +m[3]; lintText = m[5]; }
    else { const n = /^nocode \|\| (@(-?\d+)\+(\d+) .*)$/s.exec(row[2]); if (n) { lintText = n[1]; lintStart = +n[2]; lintEnd = +n[2] + +n[3]; } else lintText = row[2]; }
  }
  let plainRejects = null;
  if (typeof Bun !== "undefined") {
    try { new Bun.Transpiler({ loader: kl }).scanImports(r.s); plainRejects = false; } catch { plainRejects = true; }
  }
  let cls;
  if (parse.length) {
    if (lintOk) cls = "A";
    else if (lintCode === parse[0].code) cls = lintStart === parse[0].start ? "B=" : "B~";
    else cls = "B!";
  } else if (check.length) cls = lintOk ? "C" : "D";
  else cls = lintOk ? "F" : "E";
  counts[cls] = (counts[cls] || 0) + 1;
  if (only && !only.has(cls)) return;
  if (r.g && r.g !== group) { group = r.g; console.log("## " + group); }
  const ref = parse.length
    ? `TS${parse[0].code}@${parse[0].start}+${parse[0].length}${parse[0].text.length < 60 ? " " + parse[0].text : ""}` + (parse[1] ? ` | TS${parse[1].code}@${parse[1].start}` : "")
    : check.length ? "checker " + check.slice(0, 2).map(d => `TS${d.code}@${d.start}+${d.length} ${d.text.slice(0, 74)}`).join(" | ") : "ok";
  const lintShown = lintOk ? "accepts" + (arg("--counts") ? " " + row[2] : "") : (lintCode ? `TS${lintCode}@${lintStart}+${lintEnd - lintStart}` : "nocode") + " " + lintText;
  const plain = plainRejects === null || plainRejects === !lintOk ? "" : `  plain: ${plainRejects ? "rejects" : "accepts"}`;
  console.log(`${cls.padEnd(3)} ${l === "ts" ? "" : "[" + l + "] "}${JSON.stringify(r.s)}  ref: ${ref}  lint: ${lintShown}${plain}`);
});
console.log("# counts " + JSON.stringify(counts));
