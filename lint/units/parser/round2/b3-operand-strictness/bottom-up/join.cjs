// usage: node join.cjs <bun under test> <inputs file>...
// per source: the first parse diagnostic of typescript-go (byte offsets), whether tsc 6.0.2 has the same one, and what the parse pass alone (scanImports) of the bun under test says.
// classes: REJECT = typescript-go rejects, the parse pass of bun takes it (what B3 is about); ok = both take it; native = both reject; over = only bun rejects.
const ts = require("/workspace/bun/node_modules/typescript");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const bun = process.argv[2];
const inputs = [];
for (const file of process.argv.slice(3)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    if (line.startsWith("#")) { inputs.push({ comment: line }); continue; }
    let loader = "ts", rest = line;
    const m = /^(ts|tsx|js|jsx):(.*)$/s.exec(line);
    if (m) { loader = m[1]; rest = m[2]; }
    inputs.push({ id: inputs.length, loader, code: JSON.parse(rest) });
  }
}
const real = inputs.filter(i => !i.comment);
const p = spawnSync("/tmp/rr/parsediag", ["-max", "8"], { input: real.map(r => JSON.stringify({ id: r.id, name: "input." + r.loader, text: r.code })).join("\n") + "\n", maxBuffer: 1 << 28 });
const go = new Map();
for (const line of String(p.stdout).split("\n")) { if (!line) continue; const r = JSON.parse(line); go.set(r.id, r); }
const script = `
const rows = JSON.parse(await Bun.stdin.text());
const out = [];
for (const r of rows) {
  const t = new Bun.Transpiler({ loader: r.loader });
  let scan = "ok";
  try { t.scanImports(r.code); } catch (e) { const x = (e?.errors ?? [e])[0]; scan = "ERR @" + (x.position?.offset ?? "?") + "+" + (x.position?.length ?? "?") + " " + x.message; }
  out.push([r.id, scan]);
}
console.log(JSON.stringify(out));`;
fs.writeFileSync("/tmp/b3-join-bun.mjs", script);
const b = spawnSync(bun, ["/tmp/b3-join-bun.mjs"], { input: JSON.stringify(real), maxBuffer: 1 << 28 });
const bunRows = new Map(JSON.parse(String(b.stdout)));
const counts = {};
for (const i of inputs) {
  if (i.comment) { console.log(i.comment); continue; }
  const g = go.get(i.id)?.d ?? [];
  const sf = ts.createSourceFile("x." + i.loader, i.code, ts.ScriptTarget.Latest, false, kinds[i.loader]);
  const bo = off => Buffer.byteLength(i.code.slice(0, off));
  const t = sf.parseDiagnostics.map(d => [d.code, bo(d.start), bo(d.start + d.length) - bo(d.start), ts.flattenDiagnosticMessageText(d.messageText, "\n")]);
  const same = JSON.stringify(t[0] ?? null) === JSON.stringify(g[0] ?? null);
  const scan = bunRows.get(i.id);
  const cls = g.length ? (scan === "ok" ? "REJECT" : "native") : (scan === "ok" ? "ok    " : "over  ");
  counts[cls.trim()] = (counts[cls.trim()] ?? 0) + 1;
  const first = g[0] ? `TS${g[0][0]} @${g[0][1]}+${g[0][2]} ${JSON.stringify(g[0][3].length > 60 ? g[0][3].slice(0, 57) + "..." : g[0][3])}` : "parses";
  console.log(`${cls} ${i.loader.padEnd(3)} ${JSON.stringify(i.code)}  go: ${first}${same ? "" : "  [tsc differs]"}${scan === "ok" ? "" : "  bun: " + scan}`);
}
console.error(JSON.stringify(counts));
