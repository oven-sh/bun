// Every run instance of the corpus in the committed layout through the replay check: the oracle that the four steps of oracleOf select
// (674 files of typescript-go, 6353 of TypeScript, 23 names of the list) has to come back byte for byte, as it does in the layout of the clone.
// usage: bun replay_committed_layout.ts <assembled runner set> <conformance directory of the scratch repository>
const [asm, home] = process.argv.slice(2);
const R = await import(asm + "/test/cli/lint/conformance/runner/index.ts");
const layout = {
  casesRoot: home + "/corpus/ts/tests/cases",
  libRoot: home + "/corpus/ts/tests/lib",
  tsgoBaselines: home + "/corpus/tsgo/testdata/baselines/reference/submodule",
  tsBaselines: home + "/corpus/ts/tests/baselines/reference",
  expectsNoErrors: home + "/corpus/tsgo.expects-no-errors.txt",
  accepted: home + "/corpus/tsgo/testdata/submoduleAccepted.txt",
  triaged: home + "/corpus/tsgo/testdata/submoduleTriaged.txt",
  postEmitOrder: asm + "/test/cli/lint/conformance/post-emit-order.txt",
};
const corpus = R.loadCorpus(layout);
const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
const inputs: any[] = [];
const notBuilt: Record<string, number> = {};
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const r = R.inputOf(i, { layout });
  if (r.ok) inputs.push(r.input);
  else notBuilt[r.status + ": " + r.reason.slice(0, 80)] = (notBuilt[r.status + ": " + r.reason.slice(0, 80)] ?? 0) + 1;
}
const oracle = (i: any) => R.runOracleOf(corpus, i.suite, i.name);
const results = await R.runInstances(inputs, R.replayCheck(oracle), { oracle });
const tally: Record<string, number> = {};
for (const r of results) tally[`${r.kind} ${r.status}`] = (tally[`${r.kind} ${r.status}`] ?? 0) + 1;
console.log(JSON.stringify({ run: e.instances.filter((i: any) => i.status === "run").length, inputs: inputs.length, notBuilt, results: tally }));
