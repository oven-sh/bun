import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] || "mdx-benchmark-results");
const raw = JSON.parse(readFileSync(join(root, "html-raw.json"), "utf8"));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const geomean = values => Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
const rows = [];
for (const id of new Set(raw.flatMap(run => run.results.map(result => result.id)))) {
  for (const mode of ["html", "render-only"]) {
    const timings = {};
    for (const engine of ["native", "reference"]) {
      const runs = raw.filter(run => run.engine === engine && run.mode === mode);
      if (runs.length !== 3) throw new Error(`Incomplete rounds for ${engine}/${mode}`);
      const perRoundMs = runs.map(run => {
        const item = run.results.find(item => item.id === id);
        if (!item || item.batchMs.length !== 40) throw new Error(`Incomplete samples for ${id}`);
        return median(item.batchMs.map(value => value / item.batch));
      });
      timings[engine] = { medianMs: median(perRoundMs), perRoundMs };
    }
    rows.push({ id, mode, timings, speedup: timings.reference.medianMs / timings.native.medianMs });
  }
}
const aggregates = ["html", "render-only"].map(mode => {
  const selected = rows.filter(row => row.mode === mode);
  return {
    mode,
    geomeanSpeedup: geomean(selected.map(row => row.speedup)),
    perRoundGeomeans: [0, 1, 2].map(round =>
      geomean(selected.map(row => row.timings.reference.perRoundMs[round] / row.timings.native.perRoundMs[round])),
    ),
  };
});
writeFileSync(join(root, "html-summary.json"), JSON.stringify({ aggregates, rows }, null, 2) + "\n");
writeFileSync(
  join(root, "html-summary.csv"),
  [
    "id,mode,native_ms,reference_ms,speedup",
    ...rows.map(row =>
      [row.id, row.mode, row.timings.native.medianMs, row.timings.reference.medianMs, row.speedup].join(","),
    ),
  ].join("\n") + "\n",
);
console.log(JSON.stringify(aggregates, null, 2));
