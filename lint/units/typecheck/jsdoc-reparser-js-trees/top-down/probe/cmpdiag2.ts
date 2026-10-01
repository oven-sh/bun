// Probe: parse diagnostics and JSDoc diagnostics of JavaScript units under route A against typescript-go's.
// Parse diagnostics of route A = TypeScript's parse diagnostics plus the errors that the reparser pass reports.
import fs from "node:fs";
import path from "node:path";
import { importRouteA } from "./difftree2.ts";
const CORPUS = "/tmp/tsimp/corpus", GOOUT = "/tmp/tsimp/go-out";
const sameTrees = new Set(fs.readFileSync(process.env.SAME ?? "/tmp/jsr/r5u.same.txt", "utf8").split("\n").filter(Boolean));
const filter = new RegExp(process.argv[2] ?? "\\.(js|jsx|mjs|cjs)$");
const res: any = { parse: { units: 0, with: 0, same: 0, differ: 0, differSameTree: 0, ex: [] as string[], cls: new Map<string, number>() }, jsdoc: { units: 0, with: 0, same: 0, differ: 0, differSameTree: 0, ex: [] as string[], cls: new Map<string, number>() } };
for (const vname of fs.readdirSync(CORPUS).sort()) {
  if (!filter.test(vname)) continue;
  const lines = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n");
  const pick = (label: string) => lines.filter(l => l.startsWith(label + " ")).map(l => { const m = /^\S+ \[(-?\d+),(-?\d+)\) TS(\d+)/.exec(l)!; return `${m[1]},${m[2]},${m[3]}`; }).sort();
  const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
  const { root, d } = importRouteA(vname, raw);
  const conv = (a: any[]) => a.map(x => `${x[0]},${x[0] + x[1]},${x[2]}`);
  const mineParse = [...conv(d.diagnostics), ...(root.reparseDiagnostics ?? []).map((x: any) => `${x.pos},${x.end},${x.code}`)].sort();
  const mineJsdoc = conv(d.jsDocDiagnostics ?? []).sort();
  for (const [key, go, mine] of [["parse", pick("diagnostic"), mineParse], ["jsdoc", pick("jsdocDiagnostic"), mineJsdoc]] as const) {
    const r = res[key];
    r.units++;
    if (go.length === 0 && mine.length === 0) continue;
    r.with++;
    if (go.join("|") === mine.join("|")) { r.same++; continue; }
    r.differ++;
    if (sameTrees.has(vname)) r.differSameTree++;
    const og = go.filter(x => !mine.includes(x)).map(x => "TS" + x.split(",")[2]), om = mine.filter(x => !go.includes(x)).map(x => "TS" + x.split(",")[2]);
    const cls = `only typescript-go: ${[...new Set(og)].join(",") || "-"}; only route A: ${[...new Set(om)].join(",") || "-"}${sameTrees.has(vname) ? "" : " [tree differs]"}`;
    r.cls.set(cls, (r.cls.get(cls) ?? 0) + 1);
    if (r.ex.length < 6) r.ex.push(`${vname}: go ${go.filter(x => !mine.includes(x)).join(" ")} | mine ${mine.filter(x => !go.includes(x)).join(" ")}`);
  }
}
for (const key of ["parse", "jsdoc"]) {
  const r = res[key];
  console.log(`${key} diagnostics: units ${r.units}, with any ${r.with}, equal ${r.same}, different ${r.differ} (on a tree equal to typescript-go's: ${r.differSameTree})`);
  for (const [k, v] of [...r.cls].sort((a: any, b: any) => b[1] - a[1])) console.log("   ", v, k);
  for (const e of r.ex) console.log("     e.g.", e);
}
