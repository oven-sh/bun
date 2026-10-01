import fs from "node:fs";
import { importRouteA } from "./difftree2.ts";
const same = new Set(fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean));
for (const vname of [...same].sort()) {
  const lines = fs.readFileSync("/tmp/tsimp/go-out/" + vname + ".tsgo.txt", "utf8").split("\n");
  const go = lines.filter(l => l.startsWith("jsdocDiagnostic ")).map(l => { const m = /^\S+ \[(-?\d+),(-?\d+)\) TS(\d+) cat=\d+ (.*)$/.exec(l)!; return `${m[1]},${m[2]},TS${m[3]}`; }).sort();
  const { d } = importRouteA(vname, fs.readFileSync("/tmp/tsimp/corpus/" + vname, "utf8"));
  const mine = (d.jsDocDiagnostics ?? []).map((x: any) => `${x[0]},${x[0] + x[1]},TS${x[2]}`).sort();
  if (go.join("|") === mine.join("|")) continue;
  const b = Buffer.from(d.text, "utf8");
  const show = (x: string) => { const [p, e] = x.split(",").map(Number); return `${x} ${JSON.stringify(b.subarray(Math.max(0, p - 14), Math.min(b.length, e + 6)).toString("utf8"))}`; };
  console.log(vname + "\n   only go:   " + go.filter(x => !mine.includes(x)).map(show).join("; ") + "\n   only mine: " + mine.filter((x: string) => !go.includes(x)).map(show).join("; "));
}
