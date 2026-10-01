// Runs the candidate dump script over the whole corpus with the self check; converts and compares.
import fs from "node:fs";
import { dump, unvisitedCensus, ts } from "./dump-ast.mjs";
import { toGo, print, Stats } from "./togo.mjs";
const lists = process.argv.slice(2);
let ok = 0, failed = 0, same = 0, diff = 0, bytes = 0;
const errs = new Map();
const stats = new Stats();
for (const spec of lists) {
  const [outdir, listFile] = spec.split(":");
  for (const a of fs.readFileSync(listFile, "utf8").split("\n")) {
    if (!a) continue;
    const eq = a.indexOf("=");
    const name = a.slice(0, eq), path = a.slice(eq + 1);
    const text = fs.readFileSync(path, "utf8");
    let d;
    try { d = dump("/" + name, text, undefined, true, { force: process.env.FORCE === "1", jsx: process.env.JSX === "1", jsDoc: process.env.JSDOC === "1" }); ok++; bytes += d.text.length; } catch (e) {
      failed++;
      const k = String(e.message).replace(/ at \d+/g, "").slice(0, 110);
      errs.set(k, [...(errs.get(k) ?? []), name]);
      continue;
    }
    const parsed = JSON.parse(d.text); parsed.header = parsed;
    const g = toGo(parsed, text, stats, {});
    const mine = print(g, []).join("\n") + "\n";
    const all = fs.readFileSync(`${outdir}/${name}.tsgo.txt`, "utf8");
    const theirs = all.slice(all.indexOf("\nroot ") + 1).split("\n").filter(l => !l.startsWith("jsdocDiagnostic ")).join("\n");
    if (mine === theirs) same++; else diff++;
  }
}
console.log(JSON.stringify({ ok, failed, same, diff, bytes }));
for (const [k, v] of [...errs.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) console.log(String(v.length).padStart(5), k, " e.g.", v.slice(0, 2).join(" "));
console.log("--- properties holding nodes that forEachChild does not visit");
for (const [k, v] of [...unvisitedCensus.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(String(v).padStart(7), k);
