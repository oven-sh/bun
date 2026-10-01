// The best that the plain format reaches at each level: the oracle replayed with what stderr holds of it (no length, no related information).
// usage: bun plainbest.ts <scratch clone>
const [scratch] = process.argv.slice(2);
const { openCorpus, replayCheck, runInstance } = await import(`${scratch}/test/cli/lint/conformance/runner`);
const corpus = openCorpus(`${scratch}/test/cli/lint/conformance/corpus`);
const full = replayCheck((i: any) => corpus.oracle(i));
const plain = async (input: any, signal: AbortSignal) => {
  const r = await full(input, signal);
  return {
    diagnostics: r.diagnostics.map((d: any) => ({
      category: d.category, code: d.code, messageText: d.messageText, next: d.next,
      location: d.location === undefined ? undefined : { file: d.location.file, line: d.location.line, character: d.location.character },
    })),
  };
};
const instances = corpus.enumerateInstances().filter((i: any) => i.status === "run" && i.oracle.class === "E");
for (const level of ["baseline", "first-section"]) {
  const counts = new Map<string, number>();
  const t = performance.now();
  for (const i of instances) {
    const r = await runInstance(i, plain, { input: (x: any, root: any) => corpus.input(x, root), oracle: (x: any) => corpus.oracle(x), level });
    const key = `${r.outcome}${r.cause ? ` [${r.cause}]` : ""} level=${r.level}${r.headerOnly === undefined ? "" : ` headerOnly=${r.headerOnly}`}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log(`asked ${level}: E ${instances.length} in ${Math.round((performance.now() - t) / 1000)} s`);
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(6)}  ${k}`);
}
