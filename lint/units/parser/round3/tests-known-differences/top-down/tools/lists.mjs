// usage: node lists.mjs   the valid TypeScript that main rejects, and the metadata that differs from tsc, by cause, over the corpora of round 2
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import causes, { validForTsc, tscParses, bunMetadataOf } from "./gd/causes.mjs";
import { recordOf } from "./gd/oracle.mjs";
import { tagOf } from "./probes/metadata.mjs";
const ND = "/workspace/notes/lint/units/parser";
const readJsonl = path => gunzipSync(readFileSync(path)).toString("utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const CORPORA = [
  ["testrows", "/tmp/r4/runs/main.testrows.jsonl.gz", ND + "/grammar-diff-oracle-and-causes/runs/oracle.testrows.jsonl.gz", ND + "/grammar-diff-oracle-and-causes/runs/head-debug.testrows.jsonl.gz"],
  ["valid-plain", "/tmp/r4/runs/main.valid-plain.jsonl.gz", null, null],
  ["targeted", "/tmp/r4/runs/main.targeted.jsonl.gz", ND + "/grammar-diff-oracle-and-causes/runs/oracle.targeted.jsonl.gz", ND + "/grammar-diff-oracle-and-causes/runs/head-debug.targeted.jsonl.gz"],
  ["targeted09", "/tmp/r4/runs/main.targeted09.jsonl.gz", ND + "/grammar-diff-oracle-and-causes/runs/oracle.targeted.jsonl.gz", ND + "/grammar-diff-oracle-and-causes/runs/head-debug.targeted.jsonl.gz"],
  ["small-sub", "/tmp/r4/runs/main.small-sub.jsonl.gz", ND + "/grammar-diff-oracle-and-causes/runs/oracle.small-sub.jsonl.gz", ND + "/grammar-diff-oracle-and-causes/runs/head-debug.small-sub.jsonl.gz"],
];
const APIS_OF_INTEREST = ["t.ts.plain", "t.tsx.plain", "t.ts.exp", "t.ts.deco"];
const rejected = []; // { corpus, api, src, ctx, t, family, mainError, head }
const metadata = []; // { corpus, src, key, main, tsc, family, head }
for (const [name, mainPath, oraclePath, headPath] of CORPORA) {
  const main = readJsonl(mainPath);
  const header = main.shift();
  const apis = header.apis;
  const oracle = new Map();
  if (oraclePath) for (const r of readJsonl(oraclePath)) if (!r.header) oracle.set(r.src, r);
  const head = new Map();
  if (headPath) {
    const h = readJsonl(headPath);
    const hh = h.shift();
    for (const r of h) head.set(r.src, { r, apis: hh.apis });
  }
  for (const rec of main) {
    let tsc = oracle.get(rec.src);
    if (!tsc) tsc = recordOf(rec.src);
    const h = head.get(rec.src);
    for (const api of APIS_OF_INTEREST) {
      const k = apis.indexOf(api);
      const base = rec.vals[rec.res[k]];
      const next = h ? h.r.vals[h.r.res[h.apis.indexOf(api)]] : null;
      const d = { src: rec.src, ctx: rec.ctx, t: rec.t, prod: rec.prod, mut: rec.mut, api, base, next: next ?? ["o", ""], tsc };
      if (base[0] === "e") {
        d.cls = "R>A";
        if (!validForTsc(d)) continue;
        let family = "unexplained";
        for (const c of causes) {
          const m = c.match(d);
          if (m) { family = typeof m === "string" ? `${c.id} ${m}` : c.id; break; }
        }
        rejected.push({ corpus: name, api, src: rec.src, ctx: rec.ctx, t: rec.t, family, mainError: base[1][0], more: base[1].length - 1, head: next ? (next[0] === "e" ? "R" : "A") : "?" , oth: (tsc.oth?.[api.includes(".tsx.") ? "tsx" : "ts"] ?? []) });
      } else if (api === "t.ts.deco" && base[0] === "o" && tscParses(d)) {
        const loose = tsc.metaLoose ?? tsc.meta;
        if (!loose) continue;
        const bun = bunMetadataOf(base[1]);
        if (bun.length === 0) continue;
        // Compare per key in emit order per key.
        const want = {};
        for (const [key, value] of loose) (want[key] ??= []).push(value);
        const seen = {};
        const total = {};
        for (const [key] of bun) total[key] = (total[key] ?? 0) + 1;
        for (const [key, value] of bun) {
          const at = (seen[key] = (seen[key] ?? -1) + 1);
          if ((want[key]?.length ?? 0) !== total[key]) { metadata.push({ corpus: name, src: rec.src, ctx: rec.ctx, t: rec.t, key, main: value, tsc: null, why: "count", valid: validForTsc(d), head: next ? next[0] : "?" }); continue; }
          const w = want[key][at];
          if (tagOf(value) !== tagOf(w)) {
            let headSame = null;
            if (next && next[0] === "o") {
              const hb = bunMetadataOf(next[1]).filter(([k2]) => k2 === key)[at];
              headSame = hb ? tagOf(hb[1]) === tagOf(w) : null;
            }
            // The cause that round 2 gave the record, with the head as next.
            let family = "?";
            if (next) {
              const d2 = { ...d, cls: "A>A", next };
              family = "unexplained";
              for (const c of causes) { const m = c.match(d2); if (m) { family = typeof m === "string" ? `${c.id} ${m}` : c.id; break; } }
            }
            metadata.push({ corpus: name, src: rec.src, ctx: rec.ctx, t: rec.t, key, main: value, mainTag: tagOf(value), tsc: w, tscTag: tagOf(w), valid: validForTsc(d), headSame, family });
          }
        }
      }
    }
  }
}
writeFileSync("/tmp/r4/list.rejected.json", JSON.stringify(rejected));
writeFileSync("/tmp/r4/list.metadata.json", JSON.stringify(metadata));
const by = (list, keyOf) => { const m = new Map(); for (const x of list) { const k = keyOf(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
console.log("## valid TypeScript that main rejects: records by corpus, api");
for (const [k, v] of by(rejected, x => `${x.corpus}\t${x.api}`)) console.log(`${v.length}\t${new Set(v.map(x => x.src)).size} sources\t${k}`);
console.log("\n## t.ts.plain by family (distinct sources over all corpora; head A/R)");
const plain = rejected.filter(x => x.api === "t.ts.plain");
for (const [k, v] of [...by(plain, x => x.family)].sort((a, b) => b[1].length - a[1].length)) {
  const srcs = new Map(); for (const x of v) if (!srcs.has(x.src)) srcs.set(x.src, x);
  const headA = [...srcs.values()].filter(x => x.head === "A").length, headR = [...srcs.values()].filter(x => x.head === "R").length;
  console.log(`${srcs.size}\thead A ${headA} R ${headR}\t${k}\te.g. ${JSON.stringify([...srcs.values()][0].src)} -> ${JSON.stringify([...srcs.values()][0].mainError[0])}`);
}
console.log("\n## metadata differs: by family (distinct sources)");
for (const [k, v] of [...by(metadata, x => `${x.family}\tvalid=${x.valid}\theadSame=${x.headSame}`)].sort((a, b) => b[1].length - a[1].length)) {
  const srcs = new Map(); for (const x of v) if (!srcs.has(x.src)) srcs.set(x.src, x);
  const e = [...srcs.values()][0];
  console.log(`${srcs.size}\t${k}\te.g. ${JSON.stringify(e.src)} ${e.key}: main ${e.mainTag} tsc ${e.tscTag}`);
}
