// usage: node lint-head.cjs [inputs module] > lint.head-<commit>.txt
// What a LINT parse of the head does with each source, as ts and as js: the probe binary of
// round2/strict-members-params-heritage/bottom-up (build-probe.sh, zz_probe.rs; PROBE, default /tmp/smph/out/bun_js_parser).
// A line is `ok`, or the first error: `@offset+length <text of bun>` and, where the table has an entry, `-> TS<code> start+length "<text>"`.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const groups = require(path.resolve(process.argv[2] || path.join(__dirname, "inputs.cjs")));
const probe = process.env.PROBE || "/tmp/smph/out/bun_js_parser";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b4ec-"));
const rows = [];
for (const [group, sources] of groups) for (const src of sources) for (const kind of ["ts", "js"]) rows.push({ group, src, kind });
fs.writeFileSync(path.join(dir, "in.hex"), rows.map((r, id) => `${id} ${r.kind} ${Buffer.from(r.src, "utf8").toString("hex")}`).join("\n") + "\n");
const env = { ...process.env, SMPH_INPUTS: path.join(dir, "in.hex"), SMPH_OUT: path.join(dir, "out.tsv") };
const run = spawnSync(probe, ["zz_probe"], { env, encoding: "utf8" });
if (run.status !== 0) throw new Error("probe failed: " + run.stderr.slice(-2000));
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
for (const line of fs.readFileSync(path.join(dir, "out.tsv"), "utf8").split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  const r = rows[Number(f[0])];
  if (f[1] === "ok" || f[1] === "panic") r.out = f[1];
  else {
    const [, stage, offset, length, code, start, end, count, bun, ref] = f;
    r.out = `${stage === "init" ? "init " : ""}@${offset}+${length} ${unhex(bun)}` + (code !== "0" ? ` -> TS${code} ${start}+${end - start} ${JSON.stringify(unhex(ref))}` : " -> no entry") + (count !== "1" ? ` (${count} messages)` : "");
  }
}
let group = null;
let src = null;
for (const r of rows) {
  if (r.group !== group) console.log(`\n== ${(group = r.group)}`);
  if (r.src !== src) console.log(JSON.stringify((src = r.src)));
  console.log(`  a.${r.kind}  ${r.out}`);
}
