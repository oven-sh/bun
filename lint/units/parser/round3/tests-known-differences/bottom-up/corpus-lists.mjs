// The sources of the three corpora of round 2 (testrows, targeted, small-sub) that main rejects and tsc takes as a whole, by the cause
// that owns them when round 1 accepted them, and the metadata values of main that differ from tsc. Writes corpus-lists.json.
// usage: bun corpus-lists.mjs     (reads runs/base.*.jsonl.gz and runs/head.*.jsonl.gz of this directory and the oracle files of
// grammar-diff-oracle-and-causes/runs; GD as in tsc-rows.mjs)
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const GD = process.env.GD ?? "/tmp/tkd/gd";
const { default: causes, tscParses, tscGrammar, validForTsc, tscOther, bunMetadataOf } = await import(GD + "/causes.mjs");
const { tagOf } = await import("/workspace/notes/lint/units/parser/probes/metadata.mjs");
const R = new URL("runs/", import.meta.url).pathname;
const N = "/workspace/notes/lint/units/parser/grammar-diff-oracle-and-causes/runs/";
function load(path) {
  const lines = gunzipSync(readFileSync(path)).toString("utf8").split("\n").filter(Boolean);
  const header = JSON.parse(lines[0]);
  const records = new Map();
  for (let i = 1; i < lines.length; i++) { const r = JSON.parse(lines[i]); records.set(r.src, r); }
  return { header, records };
}
const valueOf = (run, record, api) => record.vals[record.res[run.header.apis.indexOf(api)]];
const APIS = ["t.ts.plain", "t.tsx.plain", "t.ts.exp", "t.ts.deco"];
const FORM = new Set([2369, 2371, 2499, 2500, 1225, 1540, 1102, 2842]);
const valid = new Map(); // cause -> Map(src -> {apis, msg, oth, corp})
const meta = new Map();
let nRej = 0, nRejHeadToo = 0;
for (const c of ["testrows", "targeted", "small-sub"]) {
  const base = load(R + `base.${c}.jsonl.gz`);
  const head = load(R + `head.${c}.jsonl.gz`);
  const oracle = load(N + `oracle.${c}.jsonl.gz`).records;
  for (const [src, b] of base.records) {
    const h = head.records.get(src);
    const tsc = oracle.get(src) ?? null;
    for (const api of APIS) {
      const bv = valueOf(base, b, api);
      const hv = valueOf(head, h, api);
      const d = { src, ctx: b.ctx, t: b.t, prod: b.prod, mut: b.mut, api, cls: `${bv[0] === "e" ? "R" : "A"}>${hv[0] === "e" ? "R" : "A"}`, base: bv, next: hv, tsc };
      if (bv[0] === "e" && validForTsc(d)) {
        nRej++;
        let owner;
        if (hv[0] === "e") { owner = "ROUND 1 REJECTS TOO"; nRejHeadToo++; }
        else {
          owner = "unexplained";
          for (const cand of causes) { const m = cand.match(d); if (m) { owner = typeof m === "string" ? `${cand.id} ${m}` : cand.id; break; } }
        }
        if (!valid.has(owner)) valid.set(owner, new Map());
        const m = valid.get(owner);
        if (!m.has(src)) m.set(src, { apis: [], msg: bv[1][0], oth: tscOther(d), corp: c, head: hv[0] === "e" ? hv[1][0] : null });
        m.get(src).apis.push(api);
      }
      if (api === "t.ts.deco" && bv[0] === "o" && tsc && tsc.ts.length === 0 && (tsc.metaLoose ?? tsc.meta)) {
        const want = tsc.metaLoose ?? tsc.meta;
        const got = bunMetadataOf(bv[1]);
        const hgot = hv[0] === "o" ? bunMetadataOf(hv[1]) : null;
        if (got.length !== want.length) continue;
        for (let i = 0; i < got.length; i++) {
          if (got[i][0] !== want[i][0]) break;
          if (tagOf(got[i][1]) !== tagOf(want[i][1])) {
            const chk = tscGrammar(d) ?? [];
            let owner = "unexplained";
            if (hgot && JSON.stringify(hgot) !== JSON.stringify(got)) { for (const cand of causes) { const m = cand.match(d); if (m) { owner = typeof m === "string" ? `${cand.id} ${m}` : cand.id; break; } } }
            else owner = "ROUND 1 HAS THE SAME VALUE";
            if (!meta.has(owner)) meta.set(owner, new Map());
            if (!meta.get(owner).has(src)) meta.get(owner).set(src, { key: got[i][0], main: got[i][1], tsc: want[i][1], head: hgot ? hgot[i]?.[1] : null, chk: chk.map(x => x[0]), corp: c });
            break;
          }
        }
      }
    }
  }
}
const out = { valid: {}, meta: {} };
console.log(`base rejects and tsc takes as a whole: ${nRej} records (${nRejHeadToo} where round 1 rejects too)`);
for (const [owner, m] of [...valid].sort((a, b) => b[1].size - a[1].size)) {
  const forms = new Map();
  for (const v of m.values()) for (const c of v.oth) if (FORM.has(c)) forms.set(c, (forms.get(c) ?? 0) + 1);
  console.log(`\n## ${m.size} sources  ${owner}${forms.size ? "   [tsc reports: " + [...forms].map(([c, n]) => `TS${c} x${n}`).join(", ") + "]" : ""}`);
  out.valid[owner] = [...m].map(([src, v]) => ({ src, ...v }));
  let k = 0;
  for (const [src, v] of m) { if (k++ >= 6) break; console.log(`   ${JSON.stringify(src)}   ${v.apis.join(",")}   main: ${v.msg[0]} @${v.msg[1]}:${v.msg[2]}${v.oth.filter(c => FORM.has(c)).length ? "  TS" + v.oth.filter(c => FORM.has(c)).join(",TS") : ""}${v.head ? "  head: " + v.head[0] : ""}`); }
}
console.log("\n==== metadata of main that differs from tsc (t.ts.deco, strictNullChecks off)");
for (const [owner, m] of [...meta].sort((a, b) => b[1].size - a[1].size)) {
  console.log(`\n## ${m.size} sources  ${owner}`);
  out.meta[owner] = [...m].map(([src, v]) => ({ src, ...v }));
  let k = 0;
  for (const [src, v] of m) { if (k++ >= 6) break; console.log(`   ${JSON.stringify(src)}   ${v.key}: main ${v.main} | tsc ${v.tsc}${v.head && v.head !== v.main ? "" : " | head SAME AS MAIN"}${v.chk.length ? "  chk TS" + v.chk.join(",TS") : ""}`); }
}
writeFileSync(new URL("corpus-lists.json", import.meta.url).pathname, JSON.stringify(out));
