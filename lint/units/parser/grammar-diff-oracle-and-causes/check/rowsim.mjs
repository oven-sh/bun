// Scratch: the 366 rows of the four test files as records of diff.mjs (base: the installed binary; next: the expectation
// of the test, which the head passes), given to the cause list.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadJsonl } from "./lib.mjs";
const causes = (await import(resolve(process.argv[2]))).default;
const rows = JSON.parse(readFileSync("/tmp/gdo/testrows.base.json", "utf8"));
const oracle = new Map(loadJsonl("/tmp/gdo/oracle2.testrows.jsonl.gz").slice(1).map(r => [r.src, r]));
const API = { ts: "t.ts.plain", tsx: "t.tsx.plain", deco: "t.ts.deco" };
function metaNext(baseText, key, expected) {
  const re = /__legacyMetadataTS\w*\("(design:\w+)", /g;
  for (let m; (m = re.exec(baseText)); ) {
    let depth = 0, i = re.lastIndex;
    for (; i < baseText.length; i++) {
      const c = baseText[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; }
    }
    if (m[1] === "design:" + key) return baseText.slice(0, re.lastIndex) + expected + baseText.slice(i);
  }
  throw new Error("no " + key);
}
const table = new Map();
let n = 0;
for (const r of rows) {
  if (r.loader === "js") continue;
  n++;
  const next = ["o", r.key ? metaNext(r.base[1], r.key, r.expected) : r.expected];
  const cls = r.base[0] === "e" ? "R>A" : "A>A";
  const d = { src: r.src, ctx: null, t: null, prod: r.group, mut: null, api: API[r.loader], cls, base: r.base, next, tsc: oracle.get(r.src) ?? null };
  let owner = "unexplained";
  for (const cause of causes) {
    const m = cause.match(d);
    if (m) { owner = typeof m === "string" ? `${cause.id} ${m}` : cause.id; break; }
  }
  const g = `${r.file.replace("typescript-grammar", "tg").replace(".test.ts", "")} | ${r.group.replace(/: %.*$/, "")}`;
  const k = `${g}\t${cls}\t${owner}`;
  if (!table.has(k)) table.set(k, []);
  table.get(k).push(r.src);
}
let lastG = "";
for (const [k, list] of table) {
  const [g, cls, owner] = k.split("\t");
  if (g !== lastG) { console.log(g); lastG = g; }
  console.log(`   ${String(list.length).padStart(3)} ${cls}  ${owner}` + (/unexplained|RESTORE|FORBIDDEN/.test(owner) || process.env.EX ? "\n          " + list.slice(0, 6).map(s => JSON.stringify(s)).join("\n          ") : ""));
}
console.log(n, "rows");
