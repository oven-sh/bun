// Compares two runs of harness.mjs and gives every differing record to a cause.
//
//   bun diff.mjs <base.jsonl.gz> <next.jsonl.gz> [--oracle=<oracle.jsonl.gz>] [--causes=<causes.mjs>]
//                [--out=<diff.jsonl>] [--show=<n per cause>]
//
// Records join on the source text, results on the api name. One differing record is one (source, api).
// Classes:  A>R  base accepted, next rejects      (never allowed for a parse without lint)
//           R>A  base rejected, next accepts
//           A>A  both accept, the output differs
//           R>R  both reject, the error list differs
//           crash / hang / missing on one side
// A cause is { id, title, match(d) } with d = { src, ctx, t, prod, mut, api, cls, base, next, tsc }.
// The first cause that matches owns the record. A record that no cause owns is "unexplained".
// Exit code 1 when a record is unexplained or when a class A>R, crash, hang or missing record exists.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

function load(path) {
  const raw = readFileSync(path);
  const text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  const lines = text.split("\n").filter(Boolean);
  const header = JSON.parse(lines[0]);
  const records = new Map();
  for (let i = 1; i < lines.length; i++) {
    const r = JSON.parse(lines[i]);
    records.set(r.src, r);
  }
  return { header, records };
}

const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [basePath, nextPath] = args.filter(a => !a.startsWith("--"));
if (!basePath || !nextPath) {
  console.error("usage: bun diff.mjs <base.jsonl.gz> <next.jsonl.gz> [--oracle=..] [--causes=..] [--out=..] [--show=N]");
  process.exit(2);
}
const base = load(basePath);
const next = load(nextPath);
const oracle = flag("oracle") ? load(flag("oracle")).records : new Map();
const causes = flag("causes") ? (await import(resolve(flag("causes")))).default : [];
const show = Number(flag("show") ?? 5);

const valueOf = (run, record, api) => {
  if (record === undefined) return ["missing"];
  if (record.crash !== undefined) return [record.crash === "hang" ? "hang" : "crash", record.crash];
  const at = run.header.apis.indexOf(api);
  return at < 0 ? ["missing"] : record.vals[record.res[at]];
};
const kind = v => (v[0] === "e" ? "R" : v[0] === "o" || v[0] === "s" || v[0] === "i" ? "A" : v[0]);

const apis = base.header.apis.filter(a => next.header.apis.includes(a));
const table = new Map();
const examples = new Map();
const out = [];
let compared = 0;
let differing = 0;
const sources = new Set();
for (const src of new Set([...base.records.keys(), ...next.records.keys()])) {
  const b = base.records.get(src);
  const n = next.records.get(src);
  const meta = b ?? n;
  for (const api of apis) {
    compared++;
    const bv = valueOf(base, b, api);
    const nv = valueOf(next, n, api);
    if (JSON.stringify(bv) === JSON.stringify(nv)) continue;
    differing++;
    sources.add(src);
    const cls = `${kind(bv)}>${kind(nv)}`;
    const d = { src, ctx: meta.ctx, t: meta.t, prod: meta.prod, mut: meta.mut, api, cls, base: bv, next: nv, tsc: oracle.get(src) ?? null };
    let owner = "unexplained";
    for (const cause of causes) {
      if (cause.match(d)) {
        owner = cause.id;
        break;
      }
    }
    const key = `${owner}\t${cls}`;
    table.set(key, (table.get(key) ?? 0) + 1);
    if (!examples.has(key)) examples.set(key, []);
    if (examples.get(key).length < show) examples.get(key).push(d);
    out.push({ cause: owner, ...d });
  }
}

console.log(`base ${base.header.version} ${base.header.revision} (${base.records.size} sources)`);
console.log(`next ${next.header.version} ${next.header.revision} (${next.records.size} sources)`);
console.log(`${compared} records compared, ${differing} differ, in ${sources.size} sources`);
const title = id => causes.find(c => c.id === id)?.title ?? "";
let bad = 0;
for (const [key, count] of [...table].sort()) {
  const [owner, cls] = key.split("\t");
  const forbidden = owner === "unexplained" || !/^(R>A|A>A|R>R)$/.test(cls);
  if (forbidden) bad += count;
  console.log(`${forbidden ? "!!" : "  "} ${String(count).padStart(8)}  ${cls.padEnd(12)} ${owner}  ${title(owner)}`);
  for (const d of examples.get(key)) {
    console.log(`              ${d.api.padEnd(16)} ${JSON.stringify(d.src)}`);
    console.log(`                base ${JSON.stringify(d.base).slice(0, 200)}`);
    console.log(`                next ${JSON.stringify(d.next).slice(0, 200)}`);
  }
}
if (flag("out")) writeFileSync(flag("out"), out.map(d => JSON.stringify(d)).join("\n") + (out.length ? "\n" : ""));
process.exit(bad > 0 ? 1 : 0);
