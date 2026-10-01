// usage: node oracle.cjs [inputs module, default ./inputs.cjs] > expected.txt
// For each source: the parse diagnostics of typescript-go 89d5d5b (PARSEDIAG, default /tmp/rr/parsediag-bu, built by
// ledger/bottom-up/tsgo-oracle/build.sh) and of tsc 6.0.2 (node_modules/typescript of the worktree), as a.ts and as a.js.
// A line of tsc is printed only where it differs from the line of typescript-go. Offsets are bytes: every source is ASCII.
const { spawnSync } = require("child_process");
const path = require("path");
const ts = require(process.env.TSC || "/workspace/wt/parser/node_modules/typescript");
const groups = require(path.resolve(process.argv[2] || path.join(__dirname, "inputs.cjs")));
const bin = process.env.PARSEDIAG || "/tmp/rr/parsediag-bu";
const names = (process.env.NAMES || "a.ts,a.js").split(",");

const rows = [];
for (const [group, sources] of groups) for (const src of sources) for (const name of names) rows.push({ group, src, name });
const input = rows.map((r, id) => JSON.stringify({ id, name: r.name, src: r.src })).join("\n") + "\n";
const run = spawnSync(bin, [], { input, encoding: "utf8", maxBuffer: 1 << 28 });
if (run.status !== 0) throw new Error("parsediag failed: " + run.stderr);
for (const line of run.stdout.split("\n")) {
  if (!line) continue;
  const out = JSON.parse(line);
  rows[out.id].go = out.panic ? [["panic", out.panic]] : out.diags.map(d => [d[0], d[1], d[2], d[5]]);
}
const kinds = { ".ts": ts.ScriptKind.TS, ".js": ts.ScriptKind.JS, ".tsx": ts.ScriptKind.TSX, ".jsx": ts.ScriptKind.JSX };
for (const r of rows) {
  const sf = ts.createSourceFile("/" + r.name, r.src, ts.ScriptTarget.ESNext, true, kinds[path.extname(r.name)]);
  r.tsc = sf.parseDiagnostics.map(d => [d.code, d.start, d.length, ts.flattenDiagnosticMessageText(d.messageText, "\n")]);
}
const show = list => (list.length === 0 ? "ok" : list.map(d => (d[0] === "panic" ? `PANIC ${d[1]}` : `TS${d[0]} ${d[1]}+${d[2]} ${JSON.stringify(d[3])}`)).join(" | "));
let group = null;
let src = null;
for (const r of rows) {
  if (r.group !== group) {
    group = r.group;
    console.log(`\n== ${group}`);
  }
  if (r.src !== src) {
    src = r.src;
    console.log(JSON.stringify(r.src));
  }
  const go = show(r.go);
  const tsc = show(r.tsc);
  console.log(`  ${r.name.padEnd(5)} ${go}`);
  if (tsc !== go) console.log(`  ${r.name.padEnd(5)} tsc 6.0.2 differs: ${tsc}`);
}
