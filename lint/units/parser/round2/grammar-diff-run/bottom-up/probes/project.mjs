// bun project.mjs <tag> <corpus>: the run of the head for <corpus> with the records of the prototype run <tag> (check corpus, debug
// build) put in for every source that the check corpus has. The debug build appends " (token: T...)" to some messages: removed.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
const [tag, corpus] = process.argv.slice(2);
const R = "/tmp/gdr1a/runs";
const lines = p => gunzipSync(readFileSync(p)).toString("utf8").split("\n").filter(Boolean);
const proto = new Map();
const pl = lines(`${R}/${tag}.check.jsonl.gz`);
for (let i = 1; i < pl.length; i++) { const r = JSON.parse(pl[i]); proto.set(r.src, r); }
const strip = v => (v[0] === "e" ? ["e", v[1].map(m => [String(m[0]).replace(/ \(token: T\w+\)$/, ""), m[1], m[2]])] : v);
const hl = lines(`${R}/head.${corpus}.jsonl.gz`);
const header = JSON.parse(hl[0]);
header.revision = header.revision + "+restore.patch, projected from the debug prototype " + tag;
const out = [JSON.stringify(header)];
let replaced = 0;
for (let i = 1; i < hl.length; i++) {
  const r = JSON.parse(hl[i]);
  const p = proto.get(r.src);
  if (p && p.crash === undefined) {
    replaced++;
    const vals = [], keys = new Map(), res = [];
    for (const at of p.res) { const v = strip(p.vals[at]); const k = JSON.stringify(v); let j = keys.get(k); if (j === undefined) { j = vals.length; vals.push(v); keys.set(k, j); } res.push(j); }
    r.res = res; r.vals = vals;
  }
  out.push(JSON.stringify(r));
}
writeFileSync(`${R}/proj-${tag}.${corpus}.jsonl.gz`, gzipSync(out.join("\n") + "\n"));
console.log(`${corpus}: ${hl.length - 1} sources, ${replaced} taken from the prototype run`);
