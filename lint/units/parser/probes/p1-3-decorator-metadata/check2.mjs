import { readFileSync, writeFileSync } from "node:fs";
import { tagOfForm, cfg } from "./model.mjs";
import { tagOfForm2 } from "./model2.mjs";
const lines = readFileSync("/workspace/notes/lint/units/parser/probes/out/metadata.table.tsv", "utf8").split("\n").filter(Boolean).slice(1);
const wrap = { prop: t => `type=${t}`, param: t => `type=Function  paramtypes=[${t}]  returntype=undefined`, ret: t => `type=Function  paramtypes=[]  returntype=${t}` };
const c = { n: 0, oldOk: 0, baseChanged: 0, baseChangedNotTsc: 0, changed: 0, changedNotTsc: 0, newEqTsc: 0, stillDiff: 0 };
const oldBad = [], rej = [], bad = [], still = [], baseBad = [], rows = [];
for (const line of lines) {
  const [srcJ, formJ, pos, bun, loose] = line.split("\t");
  if (!(pos in wrap) || bun === "REJECTED") continue;
  const form = JSON.parse(formJ);
  c.n++;
  let o, b, w;
  cfg.dots = false;
  try { o = wrap[pos](tagOfForm(form, pos === "ret", false)); } catch (e) { rej.push([form, pos, "old", String(e.message).slice(0, 80)]); continue; }
  if (o !== bun) { oldBad.push([form, pos, bun, o]); continue; }
  c.oldOk++;
  try { b = wrap[pos](tagOfForm2(form, pos === "ret", false)); } catch (e) { rej.push([form, pos, "base", String(e.message).slice(0, 80)]); continue; }
  cfg.dots = true;
  try { w = wrap[pos](tagOfForm2(form, pos === "ret", true)); } catch (e) { rej.push([form, pos, "new", String(e.message).slice(0, 80)]); continue; }
  rows.push([JSON.parse(srcJ), form, pos, bun, b, w, loose]);
  if (b !== bun) { c.baseChanged++; if (b !== loose) { c.baseChangedNotTsc++; baseBad.push([form, pos, bun, b, loose]); } }
  if (w !== bun) { c.changed++; if (w !== loose) { c.changedNotTsc++; bad.push([form, pos, bun, w, loose]); } }
  if (w === loose) c.newEqTsc++; else { c.stillDiff++; still.push([form, pos, bun, w, loose]); }
}
console.log(c, { oldBad: oldBad.length, rej: rej.length });
const show = (name, list, k) => { console.log(`--- ${name} (${list.length})`); for (const r of list.slice(0, k)) console.log(r.join("\t")); };
const arg = process.argv[2] ?? "";
show("model rejects", rej, 30);
show("new: changed and not equal tsc", bad, 60);
show("base (grammar commit alone): changed and not equal tsc", baseBad, arg === "base" ? 2000 : 12);
if (arg === "still") show("new differs from tsc", still, 200);
writeFileSync("/tmp/p13/rows2.json", JSON.stringify(rows));
