import { readFileSync } from "node:fs";
const lines = readFileSync("inst.tsv", "utf8").split("\n").filter(Boolean);
const head = lines[0].split("\t");
const rows = lines.slice(1).map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
const splitLines = readFileSync("split.tsv", "utf8").split("\n").filter(Boolean).slice(1).map(l => l.split("\t"));
const keys = new Set(splitLines.map(s => s[0] + "/" + s[1]));
const run = rows.filter(r => r.status === "run");
const missing = run.filter(r => !keys.has(r.suite + "/" + r.name));
console.log("run", run.length, "split rows", splitLines.length, "missing", missing.map(r => r.suite + "/" + r.name + " kind=" + r.kind + " cfg=" + r.configuration));
// instances with a configuration file column set
const withCfg = splitLines.filter(s => s[4]);
console.log("with config column", withCfg.length);
// distinct case files among them
const runKeys = new Set(run.map(r => r.suite + "/" + r.name));
console.log("of which run", withCfg.filter(s => runKeys.has(s[0] + "/" + s[1])).length);
