import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const base = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
let total = 0, noSquiggle = 0, noSquiggleNoRelated = 0, related = 0, pretty = 0;
for (const suite of ["compiler", "conformance"]) for (const n of readdirSync(join(base, suite))) {
  if (!n.endsWith(".errors.txt")) continue;
  total++;
  const t = readFileSync(join(base, suite, n), "utf8");
  const lines = t.split(/\r?\n/);
  const sq = lines.some(l => /^\s+~+\s*$/.test(l));
  const rel = lines.some(l => l.startsWith("!!! related TS"));
  if (t.includes("\u001b[")) pretty++;
  if (rel) related++;
  if (!sq) noSquiggle++;
  if (!sq && !rel) noSquiggleNoRelated++;
}
console.log(JSON.stringify({ total, pretty, withRelated: related, noSquiggleLine: noSquiggle, noSquiggleAndNoRelated: noSquiggleNoRelated }));
