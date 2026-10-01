// bun after.mjs <tag> [corpus=check]: what the prototype changed against the head, per source and api, judged with the oracle.
//   restored       head accepted, prototype rejects, and tsc rejects the source as a whole (or the record had the mark !!)
//   OVER-RESTORED  head accepted, prototype rejects, and the source is valid for tsc as a whole
//   NEW-ACCEPT     head rejected, prototype accepts
//   output         both accept, another output
//   message        both reject, another error list
import { load } from "./lib.mjs";
const tag = process.argv[2], corpus = process.argv[3] ?? "check";
const R = "/tmp/gdr1a/runs";
const head = load(`${R}/head.${corpus}.jsonl.gz`), next = load(`${R}/${tag}.${corpus}.jsonl.gz`), base = load(`${R}/base.${corpus}.jsonl.gz`), oracle = load(`${R}/oracle.${corpus}.jsonl.gz`);
const apis = head.header.apis;
const count = {};
const show = {};
const valid = (o, api) => { const k = api.includes(".tsx.") || api.endsWith("tsx.plain") ? "tsx" : "ts"; const legacy = /\.(exp|deco)\b/.test(api); if (!o || o[k].length) return false; const g = (legacy ? o.chk?.[k + "L"] : undefined) ?? o.chk?.[k]; return g && g.length === 0; };
for (const [src, h] of head.records) {
  const n = next.records.get(src), b = base.records.get(src);
  if (!n) { count.MISSING = (count.MISSING ?? 0) + 1; continue; }
  if (n.crash !== undefined) { count.CRASH = (count.CRASH ?? 0) + 1; (show.CRASH ??= []).push(src); continue; }
  for (let a = 0; a < apis.length; a++) {
    const hv = h.vals[h.res[a]], nv = n.vals[n.res[a]], bv = b.vals[b.res[a]];
    if (JSON.stringify(hv) === JSON.stringify(nv)) continue;
    const ha = hv[0] !== "e", na = nv[0] !== "e", ba = bv[0] !== "e";
    let cls;
    if (ha && !na) cls = valid(oracle.records.get(src), apis[a]) ? "OVER-RESTORED" : "restored";
    else if (!ha && na) cls = "NEW-ACCEPT";
    else if (ha && na) cls = "output";
    else cls = "message";
    if (ha && !na && ba) cls = "A>R AGAINST BASE";
    count[cls] = (count[cls] ?? 0) + 1;
    const list = (show[cls] ??= new Map());
    if (!list.has(src)) list.set(src, [apis[a], hv[0] === "e" ? hv[1][0][0] : "A", nv[0] === "e" ? nv[1][0][0] : "A"]);
  }
}
console.log(JSON.stringify(count));
for (const [cls, list] of Object.entries(show)) {
  if (cls === "restored" || cls === "message") { console.log(`${cls}: ${list.size} sources`); continue; }
  console.log(`${cls}: ${list.size ?? list.length} sources`);
  for (const [src, v] of [...list].slice(0, 60)) console.log("   ", JSON.stringify(src), JSON.stringify(v));
}
