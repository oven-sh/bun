import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
const loaderOf = api => (api.includes(".tsx.") ? "tsx" : "ts");
const inv = new Map();
for await (const line of createInterface({ input: createReadStream("diff.small.jsonl"), crlfDelay: Infinity })) {
  if (!line.includes('"cls":"R>A"')) continue;
  const d = JSON.parse(line);
  const diags = d.tsc?.[loaderOf(d.api)] ?? [];
  if (diags.length === 0) continue;
  const key = d.t ?? d.src;
  let e = inv.get(key);
  if (!e) inv.set(key, (e = { ctx: new Set(), apis: new Set(), tsc: diags[0], base: d.base[1][0], next: d.next[1], src: d.src }));
  e.ctx.add(d.ctx); e.apis.add(d.api.split(".").slice(0, 2).join("."));
}
console.log("R>A where tsc rejects: forms", inv.size);
const byCode = {};
for (const [t, e] of inv) (byCode["TS" + e.tsc[0] + " " + e.tsc[3]] ??= []).push([t, e]);
for (const [code, list] of Object.entries(byCode).sort((a, b) => b[1].length - a[1].length)) {
  console.log(String(list.length).padStart(4), code);
  for (const [t, e] of list.slice(0, 4)) console.log("        ", JSON.stringify(t).slice(0, 50).padEnd(52), [...e.ctx].join(",").slice(0, 40).padEnd(40), [...e.apis].join(","), "| N", JSON.stringify(e.base).slice(0, 50), "| L", JSON.stringify(e.next).slice(0, 40));
}
