// usage: bun probe.cjs 'src' 'tsx:src' ...   prints typescript-go, tsc 6.0.2 and installed bun per input
const ts = require("/workspace/bun/node_modules/typescript");
const { spawnSync } = require("node:child_process");
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
// usage: bun probe.cjs --file inputs.txt   one source per line
const args = process.argv[2] === "--file"
  ? require("node:fs").readFileSync(process.argv[3], "utf8").split("\n").filter(Boolean)
  : process.argv.slice(2);
const inputs = args.map((arg, id) => {
  let loader = "ts", code = arg;
  const m = /^(ts|tsx|js|jsx|dts):(.*)$/s.exec(arg);
  if (m) { loader = m[1]; code = m[2]; }
  return { id, loader, code };
});
const byName = new Map();
for (const i of inputs) {
  const name = i.loader === "dts" ? "input.d.ts" : "input." + i.loader;
  if (!byName.has(name)) byName.set(name, []);
  byName.get(name).push(i);
}
const go = new Map();
for (const [name, list] of byName) {
  const p = spawnSync("/tmp/rr/parsediag", ["-max", "6"], { input: list.map(r => JSON.stringify({ id: r.id, name, text: r.code })).join("\n") + "\n" });
  for (const line of String(p.stdout).split("\n")) { if (!line) continue; const r = JSON.parse(line); go.set(r.id, r); }
}
for (const i of inputs) {
  console.log(JSON.stringify(i.code), "[" + i.loader + "]");
  const g = go.get(i.id);
  if (g?.panic) console.log("   go  PANIC " + g.panic.slice(0, 100));
  for (const d of g?.d ?? []) console.log(`   go  @${d[1]}+${d[2]} TS${d[0]} ${d[3]}`);
  if (g && !g.panic && !(g.d ?? []).length) console.log("   go  parses");
  const l = i.loader === "dts" ? "ts" : i.loader;
  const sf = ts.createSourceFile(i.loader === "dts" ? "x.d.ts" : "x." + l, i.code, ts.ScriptTarget.Latest, false, kinds[l]);
  for (const d of sf.parseDiagnostics.slice(0, 6)) console.log(`   tsc @${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  if (!sf.parseDiagnostics.length) console.log("   tsc parses");
  let bun = [];
  try { new Bun.Transpiler({ loader: l }).transformSync(i.code); } catch (e) { bun = (e?.errors ?? [e]).map(x => `@${x.position?.offset ?? "?"}+${x.position?.length ?? "?"} ${x.message}`); }
  for (const b of bun.slice(0, 6)) console.log("   bun " + b);
  if (!bun.length) console.log("   bun accepts");
}
