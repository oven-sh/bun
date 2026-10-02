// The cases (of the 366) whose source a run of the test binary names as failed, by family and by route.
// usage: node failed-cases.mjs <run log> <cases.tsv>
import { readFileSync } from "node:fs";
const log = readFileSync(process.argv[2], "utf8");
const cases = readFileSync(process.argv[3], "utf8").split("\n").filter(Boolean).map(l => l.split("\t"));
const head = cases[0];
const at = name => head.indexOf(name);
const DIALECT = { Ts: "ts", Tsx: "tsx", Js: "js", Decorators: "deco" };
const start = log.indexOf("a_lint_parse_reads_a_row_as_tsc_does stdout");
const end = log.indexOf("\n---- ", start + 10) < 0 ? log.indexOf("\nfailures:", start) : Math.min(log.indexOf("\n---- ", start + 10), log.indexOf("\nfailures:", start));
const body = log.slice(start, end);
const failed = new Set();
const re = /^([a-z-]+) (Ts|Tsx|Js|Decorators) ([^]*?): (Err\(|Ok\(|kept\[|TS\d+ \[)/gm;
for (let m; (m = re.exec(body)); ) failed.add(DIALECT[m[2]] + "\0" + m[3]);
const byFamily = new Map(), byNeed = new Map();
const list = [];
for (const c of cases.slice(1)) {
  const key = c[at("loader")] + "\0" + JSON.parse(c[at("source")]);
  if (!failed.has(key)) continue;
  list.push(Number(c[0]));
  byFamily.set(c[at("family")], (byFamily.get(c[at("family")]) ?? 0) + 1);
  byNeed.set(c[at("needs")], (byNeed.get(c[at("needs")]) ?? 0) + 1);
}
console.log(`${failed.size} sources, ${list.length} cases: ${list.join(" ")}`);
console.log("by family:", [...byFamily].map(([k, v]) => `${k} ${v}`).join(", "));
console.log("by route:", [...byNeed].map(([k, v]) => `${k} ${v}`).join(", "));
