// Research probe: the run of the reference against the enumeration and the oracle of the prototype.
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
const N = "/workspace/notes/lint/units/conformance/oracle-and-expectations/top-down/";
const { loadCorpus, oracleOf } = await import(N + "prototype/baseline.ts");
const { enumerateInstances } = await import("/workspace/notes/lint/units/conformance/enumerator/prototype/compiler_runner.ts");
const GO = "/workspace/ref/typescript-go";
const ref = gunzipSync(readFileSync(N + "vectors/reference-run.tsv.gz")).toString("utf8").split("\n").filter(Boolean).map(l => l.split("\t"));
const byName = new Map(ref.map(r => [r[0] + "/" + r[1], r]));
const corpus = loadCorpus({ tsgoBaselines: GO + "/testdata/baselines/reference/submodule", tsBaselines: undefined, expectsNoErrors: undefined, accepted: GO + "/testdata/submoduleAccepted.txt", triaged: GO + "/testdata/submoduleTriaged.txt", postEmitOrder: undefined });
const e = enumerateInstances({ casesRoot: GO + "/_submodules/TypeScript/tests/cases" });
let run = 0, missing = 0, kindDiffers = 0, skippedButRan = 0;
for (const i of e.instances) {
  const r = byName.get(i.suite + "/" + i.name);
  if (i.status === "run") {
    run++;
    if (r === undefined) { missing++; continue; }
    const kind = Number(r[3]) > 0 ? "E" : "C";
    if (kind !== oracleOf(corpus, i.suite, i.name).kind) kindDiffers++;
  } else if (r !== undefined) skippedButRan++;
}
console.log(JSON.stringify({ rowsOfTheReference: ref.length, uniqueRows: byName.size, runInstancesOfTheEnumeration: run, runButNotInTheReference: missing, skippedButInTheReference: skippedButRan, kindDiffers }));
