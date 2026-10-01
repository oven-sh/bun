// The best that the plain format reaches: the oracle replayed with what stderr holds of it (no length, no related information).
import { openCorpus, replayCheck, runInstance, type Check } from "./conformance/runner";
const corpus = openCorpus("/tmp/dcc-scratch/test/cli/lint/conformance/corpus");
const options = { input: (i: any, root: string | undefined) => corpus.input(i, root), oracle: (i: any) => corpus.oracle(i) };
const full = replayCheck(options.oracle);
const plain: Check = async (input, signal) => {
  const r = await full(input, signal);
  return {
    diagnostics: r.diagnostics.map(d => ({
      category: d.category, code: d.code, messageText: d.messageText, next: d.next,
      location: d.location === undefined ? undefined : { file: d.location.file, line: d.location.line, character: d.location.character },
    })),
  };
};
const counts = new Map<string, number>();
const passes: string[] = [];
let n = 0;
const t = performance.now();
for (const i of corpus.enumerateInstances()) {
  if (i.status !== "run" || i.oracle.class !== "E") continue;
  n++;
  const r = await runInstance(i, plain, options);
  const key = `${r.outcome}${r.cause ? ` [${r.cause}]` : ""}${r.headerOnly === undefined ? "" : ` headerOnly=${r.headerOnly}`}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  if (r.outcome === "pass") passes.push(i.name);
}
console.log(`E ${n} in ${Math.round((performance.now() - t) / 1000)} s`);
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(6)}  ${k}`);
console.log("pass:", passes.slice(0, 30));
