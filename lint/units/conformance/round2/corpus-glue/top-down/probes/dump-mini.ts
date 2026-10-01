import { openCorpus } from "/tmp/corpus-glue-1b/repo/test/cli/lint/conformance/runner/index.ts";
const corpus = openCorpus("/tmp/corpus-glue-1b/mini");
for (const i of corpus.enumerateInstances()) {
  const f = corpus.facts(i);
  console.log(JSON.stringify({ name: i.name, status: i.status, skipReason: i.skipReason, invalidReason: i.invalidReason, suite: i.suite, casePath: i.casePath, accepted: i.accepted, triaged: i.triaged, emitOnly: i.emitOnly, oracle: { ...i.oracle, path: i.oracle.path?.replace("/tmp/corpus-glue-1b/mini", "<root>") }, config: i.config === undefined ? undefined : Object.fromEntries(i.config), facts: { status: f.status, reason: f.reason, kind: f.kind, directory: f.directory } }));
}
