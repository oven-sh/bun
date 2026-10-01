// Lists the sources of the records with the mark !! of a diff.jsonl, one line per source.
import { readFileSync } from "node:fs";
const [path, filter] = process.argv.slice(2);
const bySrc = new Map();
for (const line of readFileSync(path, "utf8").split("\n")) {
  if (!line) continue;
  const d = JSON.parse(line);
  if (!/^(RESTORE|FORBIDDEN|NO ORACLE|unexplained)/.test(d.cause) && /^(R>A|A>A|R>R)$/.test(d.cls)) continue;
  if (filter && !d.cause.includes(filter)) continue;
  let e = bySrc.get(d.src);
  if (!e) bySrc.set(d.src, (e = { src: d.src, ctx: d.ctx, t: d.t, prod: d.prod, mut: d.mut, causes: new Set(), apis: [], base: new Set(), tsc: d.tsc }));
  e.causes.add(d.cause);
  e.apis.push(d.api);
  if (d.base[0] === "e") e.base.add(d.base[1].map(m => m[0]).join(" | "));
}
const dial = e => e.apis.every(a => a.includes(".tsx.") || a.includes("tsx")) ? "tsx" : "ts";
for (const e of bySrc.values()) {
  const k = dial(e);
  const parse = (e.tsc?.[k] ?? []).map(x => `TS${x[0]}@${x[1]} ${x[3]}`).join(" ; ");
  const chk = (e.tsc?.chk?.[k] ?? []).map(x => `TS${x[0]}@${x[1]} ${x[3]}`).join(" ; ");
  const chkL = (e.tsc?.chk?.[k + "L"] ?? []).map(x => `TS${x[0]}@${x[1]} ${x[3]}`).join(" ; ");
  console.log(JSON.stringify({ cause: [...e.causes].join(" + "), n: e.apis.length, ctx: e.ctx, prod: e.prod, mut: e.mut, t: e.t, src: e.src, base: [...e.base].join(" || "), tscParse: parse, tscChk: chk, tscChkL: chkL || undefined, oth: e.tsc?.oth?.[k] }));
}
