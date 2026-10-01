// Probe: expressions, initializers, decorators and bodies inside TypeScript type syntax.
// usage: <bun> probe.cjs <inputs.txt> [--json]
// One input per line; "\n" in a line is a line break; lines starting with "#" name a group.
// Per input: tsc 6.0.2 parse diagnostics, checker diagnostics of a one-file program (noLib, codes that are not
// about missing names or lib types), the emit of transpileModule, and Bun.Transpiler (loader ts, and tsx when the
// group name ends in " tsx") of the binary that runs this script.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const file = process.argv[2];
const json = process.argv.includes("--json");
const lines = fs.readFileSync(file, "utf8").split("\n");
const IGNORE = new Set([2304, 2318, 2552, 2503, 2307, 2792, 2580, 2591, 2584, 2583, 2585, 7006, 7031, 7008, 7010, 7011, 7013, 7015, 7016, 7017, 7019, 7020, 7022, 7023, 7024, 7032, 7033, 7034, 7005, 7018, 7053, 2451, 2300, 2339, 2322, 2345, 2693, 2749, 2364, 2362, 2363, 2365, 2367, 2531, 2532, 2533, 18046, 18047, 18048, 18049, 2454, 6133, 6196, 2315, 2314, 2344, 2538, 2536, 2537, 2540, 2741, 2739, 2740, 2353, 2554, 2555, 2349, 2351, 2348, 2347, 2350, 2694, 2702, 2708, 2709, 2686, 2695, 1155, 2448, 2449, 2450, 2588, 2630, 2631, 2632, 2809, 2301, 2683, 2532, 2722, 2721, 2774, 2872, 2873, 2845, 2869, 2871, 2870, 2365, 2447, 2356, 2357, 2358, 2359, 2360, 2361, 2703, 2704, 2790, 2839, 2571, 2698, 2700, 2461, 2488, 2548, 2549, 2495, 2497, 2305, 2306, 2724, 1259, 2877, 5097, 2835, 2834, 1479, 1471, 1484, 1485, 1286, 1287, 1295, 2691, 1192, 1208, 2306, 1375, 1378, 1308, 1431, 1432, 2712, 2307, 1323, 1324, 7036, 7026, 17004, 2875, 2874, 6142, 2786, 2604, 2607, 2602]);
function tsc(src, tsx, opts) {
  const name = tsx ? "input.tsx" : "input.ts";
  const sf = ts.createSourceFile(name, src, ts.ScriptTarget.ESNext, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const parse = sf.parseDiagnostics.map(d => "TS" + d.code + "@" + d.start);
  let check = [];
  if (!parse.length) {
    const options = Object.assign({ noLib: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, strict: false, noEmit: true, types: [], jsx: ts.JsxEmit.Preserve, experimentalDecorators: true }, opts || {});
    const host = ts.createCompilerHost(options);
    const orig = host.getSourceFile.bind(host);
    host.getSourceFile = (f, v) => (f === name ? sf : undefined);
    host.fileExists = f => f === name; host.readFile = f => (f === name ? src : undefined);
    const prog = ts.createProgram([name], options, host);
    const all = [...prog.getSyntacticDiagnostics(sf), ...prog.getSemanticDiagnostics(sf)];
    check = [...new Set(all.filter(d => !IGNORE.has(d.code)).map(d => "TS" + d.code + "@" + d.start))];
  }
  let emit = "";
  try { emit = ts.transpileModule(src, { fileName: name, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, experimentalDecorators: true } }).outputText.replace(/\s+/g, " ").trim(); } catch (e) { emit = "THROW " + e.message; }
  return { parse, check, emit };
}
function bun(src, loader) {
  if (typeof Bun === "undefined") return { ok: null };
  try {
    const t = new Bun.Transpiler({ loader, tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true } }) });
    const out = t.transformSync(src).replace(/\s+/g, " ").trim();
    return { ok: true, out };
  } catch (e) {
    const errs = e && e.errors ? e.errors : [e];
    return { ok: false, err: errs.map(x => String(x.message || x)).slice(0, 2).join(" | ") };
  }
}
let group = ""; const rows = [];
for (const raw of lines) {
  if (!raw.trim()) continue;
  if (raw.startsWith("#")) { group = raw.slice(1).trim(); continue; }
  const src = raw.replace(/\\n/g, "\n");
  const tsx = / tsx$/.test(group);
  const t = tsc(src, tsx);
  const b = bun(src, tsx ? "tsx" : "ts");
  rows.push({ group, src: raw, tscParse: t.parse, tscCheck: t.check, tscEmit: t.emit, bunOk: b.ok, bun: b.ok ? b.out : b.err });
}
if (json) { console.log(JSON.stringify(rows, null, 0)); }
else {
  let g = "";
  for (const r of rows) {
    if (r.group !== g) { g = r.group; console.log("\n## " + g); }
    const cls = (r.tscParse.length ? "P-rej" : r.tscCheck.length ? "P-ok/C-err" : "valid") + " / bun " + (r.bunOk === null ? "n/a" : r.bunOk ? "ok" : "REJ");
    console.log(`${cls.padEnd(24)} | ${r.src}`);
    console.log(`    tsc parse=[${r.tscParse.join(",")}] check=[${r.tscCheck.join(",")}]`);
    console.log(`    tsc emit: ${r.tscEmit.slice(0, 150)}`);
    console.log(`    bun: ${String(r.bun).slice(0, 150)}`);
  }
}
