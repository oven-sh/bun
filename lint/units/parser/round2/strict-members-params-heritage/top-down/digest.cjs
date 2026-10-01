// usage: <bun under test> digest.cjs <inputs.json> [--go /tmp/rr/parsediag-bu] [--only A,B,...] [--group PREFIX]
// One line per input: class, source, first diagnostic of the reference, what the running bun does without lint.
// Classes:
//   A  the reference's parser rejects, bun accepts
//   B  both reject at the parse (B= same code and start as bun's message maps to, B~ same code, B! other)
//   C  the reference's parser accepts and its checker reports a grammar error, bun accepts
//   D  the reference's parser accepts and its checker reports a grammar error, bun rejects
//   E  tsc reports nothing, bun rejects
//   F  tsc reports nothing, bun accepts
//   V  bun's parse pass accepts and its visit pass rejects (suffix of A, C, F)
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const arg = name => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };
const goBin = arg("--go");
const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
const groupPrefix = arg("--group");
const grammar = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, "checker-grammar-codes.json"), "utf8"))).map(Number));
for (const noise of [2304, 2318, 2307, 2503, 2552, 2580, 2584, 2591, 2688, 2792, 2451, 2300, 2393, 2394, 2403, 2411, 2416, 2420, 2515, 2564, 7005, 7006, 7008, 7010, 7011, 7019, 7022, 7023, 7031, 7032, 7033, 7034, 7043, 7044, 7045, 7046, 7047, 7048, 7049, 7050, 7051]) grammar.delete(noise);
const EXTRA = new Set([2369, 2371, 2680, 2681, 2730, 2390, 2391, 2499, 2500, 2754, 1211, 1166, 1168, 1169, 1170, 2463, 2464, 2465, 2466, 2467, 2470, 2471, 2472, 2473, 18004, 18006, 18010, 18011, 18012, 18013, 18014, 18016, 18019, 18028, 18036, 2809, 2427, 2457, 2819, 2374, 2375, 2377, 2378, 2379, 2380, 2382, 2383, 2384, 2385, 2386, 2387, 2389, 2392, 2396, 2398, 2408, 2409, 2410, 2413, 2414, 2415, 2422, 2423, 2425, 2426, 2428, 2430, 2432, 2433, 2434, 2435, 2436, 2437, 2438, 2439, 2440, 2441, 2523, 2524, 2660, 2662, 2663, 2664, 2665, 2666, 2667, 2668, 2669, 2670, 2671, 2672, 2673, 2674, 2675, 2676, 2677, 2678, 2679, 2714, 2715, 2716, 2717, 2718, 2719, 2720, 2721, 2722, 2723, 2724, 2725, 2726, 2727, 2728, 2729, 2731, 2732, 2733, 2734, 2735, 2736, 2737, 2738, 2739, 2796, 2797, 2798, 2799, 2800, 2801, 2802, 2803, 2804, 2805, 2806, 2807, 2808, 2810, 2811, 2812, 2813, 2814, 2815, 2816, 2817, 2818, 4112, 4113, 4114, 4115, 4116, 4117, 4118, 4119, 4120, 4121, 4122, 4123, 4124, 4125, 4126, 4127, 8000, 8001, 8002, 8003, 8004, 8005, 8006, 8008, 8009, 8010, 8011, 8012, 8013, 8016, 8017, 17000, 17001, 17002, 17004, 17005, 17006, 17007, 17008, 17009, 17010, 17011, 17012, 17013, 17014, 17015, 17016, 17017, 17018, 17019, 17020, 17021]);
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
// The code that a lint parse gives a message of bun today: API.md, "What an entry means".
const mapped = text => {
  let m = /^Expected identifier but found "?([^"]*)"?$/.exec(text);
  if (m) return ts.SyntaxKind[ts.stringToToken?.(m[1]) ?? 0] && ts.stringToToken(m[1]) >= ts.SyntaxKind.FirstReservedWord && ts.stringToToken(m[1]) <= ts.SyntaxKind.LastReservedWord ? 1359 : 1003;
  m = /^Expected "(.*)" but found /.exec(text);
  if (m) return 1005;
  if (/^Unterminated string literal/.test(text)) return 1002;
  if (/^Unexpected /.test(text)) return "U";
  return null;
};
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
      .filter(d => grammar.has(d.code) || EXTRA.has(d.code))
      .map(d => ({ code: d.code, start: d.start, length: d.length, text: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
  }
  const g = go.get(id);
  const goFirst = g && (g.diags || [])[0];
  let scan = [], full = [];
  if (typeof Bun !== "undefined") {
    const fmt = e => (e?.errors ?? [e]).map(x => ({ start: x.position?.offset ?? -1, length: x.position?.length ?? -1, text: String(x.message) }));
    try { new Bun.Transpiler({ loader: kl }).scanImports(r.s); } catch (e) { scan = fmt(e); }
    try { new Bun.Transpiler({ loader: kl }).transformSync(r.s); } catch (e) { full = fmt(e); }
  }
  const bunParseRejects = scan.length > 0;
  const bunVisitRejects = !bunParseRejects && full.length > 0;
  let cls;
  const bunFirst = scan[0];
  if (parse.length) {
    if (!bunParseRejects) cls = "A";
    else {
      const code = mapped(bunFirst.text);
      const sameCode = code === parse[0].code || (code === "U" && [1109, 1128, 1110, 1131].includes(parse[0].code));
      cls = sameCode && bunFirst.start === parse[0].start ? "B=" : sameCode ? "B~" : "B!";
    }
  } else if (check.length) cls = bunParseRejects ? "D" : "C";
  else cls = bunParseRejects ? "E" : "F";
  if (bunVisitRejects) cls += "V";
  counts[cls] = (counts[cls] || 0) + 1;
  if (only && !only.has(cls.replace("V", "")) && !only.has(cls)) return;
  if (r.g && r.g !== group) { group = r.g; console.log("## " + group); }
  const ref = parse.length
    ? `TS${parse[0].code}@${parse[0].start}+${parse[0].length}${parse[0].text.length < 48 ? " " + parse[0].text : ""}` + (parse[1] ? ` | TS${parse[1].code}@${parse[1].start}` : "")
    : check.length ? "checker " + check.slice(0, 2).map(d => `TS${d.code}@${d.start}+${d.length} ${d.text.slice(0, 70)}`).join(" | ") : "ok";
  const goDiffers = g && (g.panic ? "go PANIC" : goFirst ? (parse.length && goFirst[0] === parse[0].code && goFirst[1] === parse[0].start ? "" : `go TS${goFirst[0]}@${goFirst[1]}+${goFirst[2]}`) : (parse.length ? "go parses" : ""));
  const bun = bunParseRejects ? scan.slice(0, 2).map(b => `@${b.start}+${b.length} ${b.text}`).join(" | ") : bunVisitRejects ? "visit: " + full.slice(0, 1).map(b => `@${b.start}+${b.length} ${b.text}`).join("") : "accepts";
  console.log(`${cls.padEnd(3)} ${l === "ts" ? "" : "[" + l + "] "}${JSON.stringify(r.s)}  ref: ${ref}${goDiffers ? "  <" + goDiffers + ">" : ""}  bun: ${bun}`);
});
console.log("# counts " + JSON.stringify(counts));
