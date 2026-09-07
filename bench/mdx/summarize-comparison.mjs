import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2]);
const read = name => JSON.parse(readFileSync(join(directory, name), "utf8"));
const median = values => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const geomean = values => Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
const raw = read("comparison-raw.json");
const cases = [...new Set(raw.flatMap(worker => worker.result.map(result => result.id)))];
const rows = ["jsx", "js"].flatMap(stage =>
  cases.map(id => {
    const engines = Object.fromEntries(
      ["before", "after"].map(engine => {
        const roundMs = raw
          .filter(worker => worker.engine === engine && worker.stage === stage)
          .map(worker => {
            const result = worker.result.find(result => result.id === id);
            return median(result.batchMs.map(ms => ms / result.batch));
          });
        return [engine, { roundMs, medianMs: median(roundMs) }];
      }),
    );
    return { id, stage, ...engines, speedup: engines.before.medianMs / engines.after.medianMs };
  }),
);
const summary = {
  rows,
  realDocumentGeomeans: Object.fromEntries(
    ["jsx", "js"].map(stage => [
      stage,
      geomean(rows.filter(row => row.stage === stage && !row.id.startsWith("synthetic-")).map(row => row.speedup)),
    ]),
  ),
};
if (existsSync(join(directory, "corpus-timing-raw.json"))) {
  const corpus = read("corpus-timing-raw.json");
  const engines = Object.fromEntries(
    ["before", "after"].map(engine => {
      const roundMs = corpus.filter(worker => worker.engine === engine).map(worker => median(worker.corpusMs));
      return [engine, { roundMs, medianMs: median(roundMs) }];
    }),
  );
  summary.corpus = {
    documents: corpus[0].cases.length,
    ...engines,
    speedup: engines.before.medianMs / engines.after.medianMs,
  };
}
writeFileSync(join(directory, "comparison-summary.json"), JSON.stringify(summary, null, 2) + "\n");
const csvField = value => `"${String(value).replaceAll('"', '""')}"`;
const csv = [
  "id,stage,before_ms,after_ms,speedup",
  ...rows.map(row => [row.id, row.stage, row.before.medianMs, row.after.medianMs, row.speedup].map(csvField).join(",")),
];
writeFileSync(join(directory, "comparison-summary.csv"), csv.join("\n") + "\n");
console.log(JSON.stringify(summary, null, 2));
