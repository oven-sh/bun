// Research probe: the first section of every error baseline of typescript-go.
import { readdirSync, readFileSync } from "node:fs";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
let total = 0, pretty = 0, plain = 0, noSplit = 0, splitNotBeforeHeader = 0, lfOnly = 0, empty = 0, noTrailing = 0;
const prettyNames: string[] = [];
const odd: string[] = [];
let globalOnlyFirst = 0;
for (const suite of ["compiler", "conformance"]) {
  for (const f of readdirSync(GO + "/" + suite).sort()) {
    if (!f.endsWith(".errors.txt")) continue;
    total++;
    const t = readFileSync(GO + "/" + suite + "/" + f).toString("latin1");
    if (t.length === 0) empty++;
    if (t.startsWith("\x1b[")) { pretty++; prettyNames.push(suite + "/" + f); continue; }
    plain++;
    const k = t.indexOf("\r\n\r\n\r\n");
    if (k < 0) { noSplit++; odd.push(f); continue; }
    const rest = t.slice(k + 6);
    if (!rest.startsWith("==== ")) { splitNotBeforeHeader++; odd.push(f + " -> " + JSON.stringify(rest.slice(0, 60))); }
    if (/(^|[^\r])\n/.test(t.slice(0, k))) lfOnly++;
  }
}
console.log(JSON.stringify({ total, pretty, plain, noSplit, splitNotBeforeHeader, lfOnlyInFirstSection: lfOnly, empty }));
console.log(odd.slice(0, 10));
console.log(prettyNames);
