// For the inputs that tsc parses and the parse pass of bun rejects: the grammar errors of tsc's checker (no lib).
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const read = f => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const inputs = read("/tmp/smph/inputs.jsonl");
const bun = new Map(read("/tmp/smph/bun.head.jsonl").map(r => [r.i, r]));
const isGrammar = c => c === 9999 || (c >= 1000 && c < 2000) || c === 2880 || (c >= 8000 && c < 9000) || (c >= 17000 && c < 19000);
const generic = m => m.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "N").replace(/(Getter|Setter) \S+ /, "$1 X ");
const out = fs.createWriteStream("/tmp/smph/Y.checked.jsonl");
const byKey = new Map();
let n = 0;
for (const r of inputs) {
  const b = bun.get(r.i);
  if (!b || r.t || !b.scan) continue;
  n++;
  const name = "input.ts";
  const host = ts.createCompilerHost({});
  host.getSourceFile = f => (f === name ? ts.createSourceFile(name, r.s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) : undefined);
  host.fileExists = f => f === name;
  host.readFile = f => (f === name ? r.s : undefined);
  const program = ts.createProgram([name], { noLib: true, noResolve: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, types: [], experimentalDecorators: true, noEmit: true, strict: false }, host);
  const file = program.getSourceFile(name);
  let all;
  try { all = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]; } catch (e) { all = [{ code: 9999, start: 0, length: 0 }]; }
  const g = all.filter(d => isGrammar(d.code));
  const other = all.filter(d => !isGrammar(d.code)).map(d => d.code);
  const first = g[0] ? [g[0].code, g[0].start, g[0].length] : null;
  out.write(JSON.stringify({ i: r.i, c: first, o: [...new Set(other)].slice(0, 5) }) + "\n");
  const key = (first ? "TS" + first[0] : "valid" + (other.filter(c => ![2304, 2318, 2339, 2503, 2552, 2580, 2583, 2584, 2693, 2694, 7006, 7008, 7010, 7031, 2300, 2451, 2391, 2393, 2394, 2322, 2355, 2378, 2564, 2307, 2792].includes(c)).length ? "(semantic)" : "")) + " | " + generic(b.scan[2]);
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push({ r, b, first });
}
out.end();
console.log(n + " inputs");
for (const [key, list] of [...byKey].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
  console.log("## " + key + "  (" + list.length + ")");
  for (const { r, b, first } of list.slice(0, Number(process.argv[2] || 2))) console.log("   " + JSON.stringify(r.s) + (first ? ` tsc checker TS${first[0]}@${first[1]}+${first[2]}` : "") + ` | bun @${b.scan[0]}+${b.scan[1]} ${b.scan[2]}`);
}
