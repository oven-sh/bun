// usage: node gen-rust-rows.cjs table.txt > rust-rows.txt
// Prints, for each source of the table, a row for a Rust test: the source, the loader, and code, start, end and text of the FIRST parse diagnostic of typescript-go 89d5d5b (byte offsets; /tmp/rr/parsediag).
// A source that typescript-go parses is printed as a comment line "parses".
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const inputs = lines.map((line, id) => {
  if (line.startsWith("#")) return { comment: line };
  let loader = "ts", rest = line;
  const m = /^(ts|tsx|js|jsx):(.*)$/s.exec(line);
  if (m) { loader = m[1]; rest = m[2]; }
  return { id, loader, code: JSON.parse(rest) };
});
const real = inputs.filter(i => !i.comment);
const p = spawnSync("/tmp/rr/parsediag", ["-max", "2"], { input: real.map(r => JSON.stringify({ id: r.id, name: "input." + r.loader, text: r.code })).join("\n") + "\n", maxBuffer: 1 << 28 });
const go = new Map();
for (const line of String(p.stdout).split("\n")) { if (!line) continue; const r = JSON.parse(line); go.set(r.id, r); }
const loaders = { ts: "Loader::Ts", tsx: "Loader::Tsx", js: "Loader::Js", jsx: "Loader::Jsx" };
const bytes = s => "b" + JSON.stringify(s).replace(/[\u0080-\uffff]/g, c => Buffer.from(c).toString("hex").replace(/../g, "\\x$&"));
for (const i of inputs) {
  if (i.comment) { console.log("    // " + i.comment.slice(2)); continue; }
  const d = (go.get(i.id)?.d ?? [])[0];
  if (!d) { console.log(`    // parses: (${bytes(i.code)}, ${loaders[i.loader]}),`); continue; }
  console.log(`    (${bytes(i.code)}, ${loaders[i.loader]}, ${d[0]}, ${d[1]}, ${d[1] + d[2]}, ${JSON.stringify(d[3])}),`);
}
