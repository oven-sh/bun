// Probe: parse diagnostics and JSDoc diagnostics of JavaScript units, TypeScript 6.0.2 plus the reparse pass against typescript-go.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump } from "./convert.mjs";
const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus";
const GOOUT = process.env.GOOUT ?? "/tmp/jsdocrp/go-js";
const filter = new RegExp(process.argv[2] ?? "\\.(js|jsx|mjs|cjs)$");
function goList(lines: string[], label: string) {
  const out: string[] = [];
  const re = new RegExp("^" + label + " \\[(-?\\d+),(-?\\d+)\\) TS(\\d+) ");
  for (const l of lines) { const m = re.exec(l); if (m) out.push(`${m[1]},${m[2]},${m[3]}`); }
  return out;
}
let units = 0;
const res = { parse: { same: 0, withAny: 0 }, parseWithReparse: { same: 0 }, jsdoc: { same: 0, withAny: 0, sameSet: 0 } };
const cls = new Map<string, string[]>();
const add = (k: string, v: string) => { if (!cls.has(k)) cls.set(k, []); cls.get(k)!.push(v); };
for (const vname of fs.readdirSync(CORPUS).sort()) {
  if (!filter.test(vname)) continue;
  units++;
  const go = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n");
  const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
  const bundle = dumpFiles([{ name: "/" + vname, text: raw }]);
  const f = bundle.files[0];
  const root = importDump(JSON.parse(JSON.stringify(bundle)));
  const tsParse = f.diagnostics.map(d => `${d[0]},${d[0] + d[1]},${d[2]}`);
  const goParse = goList(go, "diagnostic");
  if (tsParse.length || goParse.length) res.parse.withAny++;
  if (tsParse.join(" ") === goParse.join(" ")) res.parse.same++;
  // the diagnostics of the reparse pass, merged by position after the last diagnostic that starts before the host ends
  const merged = [...tsParse];
  for (const d of root.reparseDiagnostics ?? []) {
    const e = `${d.pos},${d.end},${d.code}`;
    let i = merged.length;
    while (i > 0 && Number(merged[i - 1].split(",")[0]) > d.pos) i--;
    if (i > 0 && Number(merged[i - 1].split(",")[0]) === d.pos) continue;
    merged.splice(i, 0, e);
  }
  if (merged.join(" ") === goParse.join(" ")) res.parseWithReparse.same++;
  else add(`parse: go[${goParse.filter(x => !merged.includes(x)).map(x => "TS" + x.split(",")[2]).join(",")}] ts[${merged.filter(x => !goParse.includes(x)).map(x => "TS" + x.split(",")[2]).join(",")}]`, vname);
  const tsJ = f.jsDocDiagnostics.map(d => `${d[0]},${d[0] + d[1]},${d[2]}`);
  const goJ = goList(go, "jsdocDiagnostic");
  if (tsJ.length || goJ.length) res.jsdoc.withAny++;
  if (tsJ.join(" ") === goJ.join(" ")) res.jsdoc.same++;
  if ([...tsJ].sort().join(" ") === [...goJ].sort().join(" ")) res.jsdoc.sameSet++;
  else add(`jsdoc: go[${[...new Set(goJ.filter(x => !tsJ.includes(x)).map(x => "TS" + x.split(",")[2]))].join(",")}] ts[${[...new Set(tsJ.filter(x => !goJ.includes(x)).map(x => "TS" + x.split(",")[2]))].join(",")}]`, vname);
}
console.log(`units ${units}`);
console.log(`parse diagnostics: units with any ${res.parse.withAny}; identical lists ${res.parse.same}; identical after merging the reparse diagnostics ${res.parseWithReparse.same}`);
console.log(`jsdoc diagnostics: units with any ${res.jsdoc.withAny}; identical lists ${res.jsdoc.same}; identical as sets ${res.jsdoc.sameSet}`);
for (const [k, v] of [...cls].sort((a, b) => b[1].length - a[1].length)) console.log(String(v.length).padStart(5), k, " e.g.", v.slice(0, 3).join(" "));
