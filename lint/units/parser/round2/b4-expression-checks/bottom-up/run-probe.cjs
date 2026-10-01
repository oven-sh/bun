// usage: node run-probe.cjs <probe binary> <lint|plain> [inputs module] > out.txt
// Runs the probe of a scratch copy of the crate (build-scratch.sh, zz_probe.rs) over each source, as ts and as js.
// lint: `ok`, or each message of the log: `@offset+length <text of bun>` and, where the table has an entry, `-> TS<code> start+length "<text>"`.
// plain: the parse pass without a side table: `ok` or `err`, and each message.
// Environment: B4_TLA=1 (top-level await), B4_COMMENTS=1 (the lexer keeps its comments, as the lint parse will), both passed on to the probe.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const [probe, mode] = [process.argv[2], process.argv[3] || "lint"];
const groups = require(path.resolve(process.argv[4] || path.join(__dirname, "inputs.cjs")));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b4ec-"));
const rows = [];
for (const [group, sources] of groups) for (const src of sources) for (const kind of ["ts", "js"]) rows.push({ group, src, kind });
fs.writeFileSync(path.join(dir, "in.hex"), rows.map((r, id) => `${id} ${r.kind} ${Buffer.from(r.src, "utf8").toString("hex")}`).join("\n") + "\n");
const env = { ...process.env, B4_INPUTS: path.join(dir, "in.hex"), B4_OUT: path.join(dir, "out.tsv"), B4_MODE: mode };
const run = spawnSync(probe, ["zz_probe"], { env, encoding: "utf8" });
if (run.status !== 0) throw new Error("probe failed: " + run.stderr.slice(-2000));
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
for (const line of fs.readFileSync(path.join(dir, "out.tsv"), "utf8").split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  const r = rows[Number(f[0])];
  const messages = f.slice(2).map(field => {
    const [place, bun, code, start, end, ref] = field.split(":");
    return `@${place} ${unhex(bun)}` + (code === undefined ? "" : ` -> TS${code} ${start}+${end - start} ${JSON.stringify(unhex(ref))}`);
  });
  r.out = f[1] === "ok" && messages.length === 0 ? "ok" : [f[1] === "ok" || f[1] === "err" ? null : f[1], ...messages].filter(Boolean).join(" | ") || f[1];
  if (mode === "plain") r.out = `${f[1]}${messages.length ? " " + messages.join(" | ") : ""}`;
}
let group = null;
let src = null;
for (const r of rows) {
  if (r.group !== group) console.log(`\n== ${(group = r.group)}`);
  if (r.src !== src) console.log(JSON.stringify((src = r.src)));
  console.log(`  a.${r.kind}  ${r.out}`);
}
