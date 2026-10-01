// Writes the candidate forms of the reference list for a corpus in the committed layout, to compare their sizes.
// usage: bun lists.ts <assembled runner root> <conformance directory with corpus/> <out directory>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [asm, home, out] = process.argv.slice(2);
const runner = join(asm, "test/cli/lint/conformance/runner");
const R = await import(join(runner, "index.ts"));
const G = await import(join(runner, "gostrings.ts"));
const cmp = G.compareStrings as (a: string, b: string) => number;
const c = home + "/corpus";
const layout = {
  casesRoot: c + "/ts/tests/cases", libRoot: c + "/ts/tests/lib",
  tsgoBaselines: c + "/tsgo/testdata/baselines/reference/submodule", tsBaselines: c + "/ts/tests/baselines/reference",
  expectsNoErrors: c + "/tsgo.expects-no-errors.txt", accepted: c + "/tsgo/testdata/submoduleAccepted.txt", triaged: c + "/tsgo/testdata/submoduleTriaged.txt",
  postEmitOrder: join(asm, "test/cli/lint/conformance/post-emit-order.txt"),
};
const corpus = R.loadCorpus(layout);
const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
const facts = e.instances.map((i: any) => R.factsOf(corpus, i));
mkdirSync(out, { recursive: true });
const sorted = (lines: string[]) => lines.sort(cmp).join("");
// The skips alone: the name and the text that the reference prints when it skips.
writeFileSync(join(out, "reference_skips.tsv"), sorted(facts.filter((f: any) => f.status === "skipped").map((f: any) => `${f.name}\t${f.reason}\n`)));
// Every instance: name, status, reason, kind.
writeFileSync(join(out, "reference_instances.tsv"), sorted(facts.map((f: any) => `${f.name}\t${f.status}\t${f.reason}\t${f.kind ?? ""}\n`)));
// The same with the path of the case and the tags, as the first wave had it.
writeFileSync(join(out, "reference_instances_wide.tsv"), sorted(e.instances.map((i: any, k: number) => `${i.name}\t${i.suite}\t${i.casePath}\t${i.configName}\t${i.status}\t${i.reason}\t${facts[k].kind ?? ""}\t${[...i.tags, ...facts[k].tags].join(",")}\n`)));
// The subtests as Go prints them.
writeFileSync(join(out, "reference_subtests.tsv"), sorted(e.instances.map((i: any) => `${i.status === "run" ? "PASS" : "SKIP"}\t${i.testName.replaceAll(" ", "_")}\n`)));
// The run instances without an error.
writeFileSync(join(out, "reference_kinds_E.txt"), sorted(facts.filter((f: any) => f.kind === "E").map((f: any) => `${f.name}\n`)));
console.log("written", out);
