import { readFileSync } from "fs";
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map(l => JSON.parse(l));
const want = process.argv[3];
const by = new Map();
for (const r of rows) {
  if (want && r.cls !== want) continue;
  let key;
  if (r.cls === "out-diff") {
    const a = r.detail.a, b = r.detail.b;
    key = `${r.pair} | ` + JSON.stringify([a.replace(/[A-Za-z0-9_$]+/g, "w").slice(0, 60), b.replace(/[A-Za-z0-9_$]+/g, "w").slice(0, 60)]);
  } else if (Array.isArray(r.detail)) key = `${r.pair} | ` + r.detail[0].replace(/^\S+ /, "").replace(/"[^"]*"/g, '"…"');
  else key = `${r.pair} | js: ${(r.detail.js[0] ?? "").replace(/^\S+ /, "").replace(/"[^"]*"/g, '"…"')} || ts: ${(r.detail.ts[0] ?? "").replace(/^\S+ /, "").replace(/"[^"]*"/g, '"…"')}`;
  if (!by.has(key)) by.set(key, []);
  by.get(key).push(r);
}
for (const [k, v] of [...by].sort((a, b) => b[1].length - a[1].length)) console.log(v.length, k, "\n    e.g.", v[0].path.replace("/workspace/wt/parser/", ""), v[0].cls === "out-diff" ? JSON.stringify(v[0].detail) : "");
