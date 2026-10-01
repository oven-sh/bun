import { openCorpus } from "/tmp/dcc-scratch2/test/cli/lint/conformance/runner";
import { tsgoRules } from "/tmp/dcc-scratch2/test/cli/lint/conformance/runner/diagnosticwriter";
import { readErrorBaseline } from "/tmp/dcc-scratch2/test/cli/lint/conformance/runner/reader";
const table = new Set([1002, 1003, 1005, 1010, 1109, 1110, 1128, 1131, 1160, 1359, 1385, 1386, 1387, 1388]);
const corpus = openCorpus("/tmp/dcc-scratch2/test/cli/lint/conformance/corpus");
const run = corpus.enumerateInstances().filter(i => i.status === "run" && i.oracle.class === "E");
const c = { any: 0, anyPretty: 0, only: 0, onlyPretty: 0, one: 0, onePretty: 0 };
const prettyNames: string[] = [];
for (const i of run) {
  const parsed = readErrorBaseline(tsgoRules, tsgoRules.model.fromBytes(corpus.oracle(i)));
  const codes = parsed.diagnostics.map(d => d.code);
  const p = parsed.pretty;
  if (codes.some(x => table.has(x))) { c.any++; if (p) { c.anyPretty++; prettyNames.push(i.name); } }
  if (codes.every(x => table.has(x))) { c.only++; if (p) c.onlyPretty++; if (codes.length === 1) { c.one++; if (p) c.onePretty++; } }
}
console.log(c, prettyNames);
