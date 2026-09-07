import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] || "mdx-benchmark-results");
const read = name => JSON.parse(readFileSync(join(root, name), "utf8"));
const protocol = read("protocol.json");
const warm = read("warm-raw.json");
const cold = read("cold-raw.json");
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const geomean = values => Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
const engines = ["native", "reference", "node", "previous"];
const rows = [];
for (const fixture of protocol.cases) {
  for (const stage of protocol.stages) {
    const timings = {};
    for (const engine of engines) {
      const runs = warm.filter(run => run.engine === engine && run.stage === stage);
      if (runs.length !== protocol.rounds) throw new Error(`Incomplete rounds: ${engine}/${stage}`);
      const perRoundMs = runs.map(run => {
        const item = run.result.find(item => item.id === fixture.id);
        if (!item || item.batchMs.length !== protocol.samples) throw new Error(`Incomplete samples: ${fixture.id}`);
        return median(item.batchMs.map(value => value / item.batch));
      });
      timings[engine] = { medianMs: median(perRoundMs), perRoundMs };
    }
    rows.push({ ...fixture, stage, timings, speedupVsReference: timings.reference.medianMs / timings.native.medianMs });
  }
}
const aggregates = protocol.stages.map(stage => {
  const real = rows.filter(row => !row.synthetic && row.stage === stage);
  const speedups = real.map(row => row.speedupVsReference);
  return {
    stage,
    documents: real.length,
    totalBytes: real.reduce((sum, row) => sum + row.bytes, 0),
    geomeanSpeedup: geomean(speedups),
    minSpeedup: Math.min(...speedups),
    maxSpeedup: Math.max(...speedups),
    geomeanByRound: Array.from({ length: protocol.rounds }, (_, round) =>
      geomean(real.map(row => row.timings.reference.perRoundMs[round] / row.timings.native.perRoundMs[round])),
    ),
  };
});
const coldRows = [];
for (const id of new Set(cold.flatMap(run => run.result.map(item => item.id)))) {
  for (const engine of engines) {
    const runs = cold.filter(run => run.engine === engine && run.result[0]?.id === id);
    if (runs.length !== 10) throw new Error(`Incomplete cold samples: ${id}/${engine}`);
    coldRows.push({
      id,
      engine,
      samples: runs.length,
      initAndFirstCompileMs: median(runs.map(run => run.result[0].initAndFirstCompileMs)),
      processWallMs: median(runs.map(run => run.processWallMs)),
    });
  }
}
const summary = {
  aggregates,
  rows,
  cold: coldRows,
  runtimes: Object.fromEntries(engines.map(engine => [engine, warm.find(run => run.engine === engine).runtime])),
};
writeFileSync(join(root, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
writeFileSync(
  join(root, "summary.csv"),
  [
    "id,bytes,synthetic,stage,native_ms,mdx_same_bun_ms,mdx_node_ms,mdx_previous_bun_ms,speedup_vs_same_bun",
    ...rows.map(row =>
      [
        row.id,
        row.bytes,
        row.synthetic,
        row.stage,
        ...engines.map(engine => row.timings[engine].medianMs),
        row.speedupVsReference,
      ].join(","),
    ),
  ].join("\n") + "\n",
);
console.log(JSON.stringify(aggregates, null, 2));
