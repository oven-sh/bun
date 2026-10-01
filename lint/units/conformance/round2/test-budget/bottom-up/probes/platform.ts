// The instances that conformance.test.ts writes to disk (describe "listed instances"): what each platform of the test run makes of their files.
import { join } from "node:path";
import * as runner from "/tmp/test-budget-1a/repo/test/cli/lint/conformance/runner";
const root = "/tmp/test-budget-1a/repo/test/cli/lint/conformance/corpus";
const corpus = runner.openCorpus(root);
const cases = new Map(runner.listCases(`${root}/cases`).map(p => [p.slice(p.lastIndexOf("/") + 1), p]));
const names = ["ArrowFunctionExpression1.ts", "ClassDeclaration10.ts", "abstractPropertyNegative(target=es2015).ts", "castingTuple.ts", "2dArrays.ts", "abstractPropertyNegative(target=es5).ts"];
for (const name of names) {
  const path = cases.get(runner.caseBaseName(name))!;
  const instance = corpus.enumerateCase(path).find(i => i.name === name)!;
  const facts = corpus.facts(instance);
  const input = corpus.input(instance, undefined);
  console.log(name, "|", instance.status, instance.oracle.class, "| platformLimited:", facts.platformLimited, "| units:", input.ok ? input.input.units.map(u => u.unitName).join(",") : input.reason, "| links:", input.ok ? input.input.symlinks.length : "-");
}
// Over the whole corpus: how many instances that run are limited by a platform, by the platform and the reason.
const by = new Map<string, number>();
let run = 0;
for (const i of corpus.enumerateInstances()) {
  if (i.status !== "run") continue;
  run++;
  const why = corpus.facts(i).platformLimited;
  if (why === undefined) continue;
  const key = why.replace(/: .*$/, m => ": " + m.slice(2).split(":")[0]);
  by.set(key, (by.get(key) ?? 0) + 1);
}
console.log("instances that run:", run);
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(6), k);
