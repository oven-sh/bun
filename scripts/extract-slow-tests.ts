#!/usr/bin/env bun
// Downloads test-shard logs from a BuildKite build, parses per-file timings,
// and emits the top-N slowest test files as JSON.
//
// Usage: bun scripts/extract-slow-tests.ts <build-number> [job-name-filter] [topN]
//   bun scripts/extract-slow-tests.ts 46916 "debian: 13 x64 - test-bun" 500

import { $ } from "bun";

const build = process.argv[2];
const jobFilter = process.argv[3] ?? "debian: 13 x64 - test-bun";
const topN = parseInt(process.argv[4] ?? "500", 10);

if (!build) {
  console.error("usage: bun scripts/extract-slow-tests.ts <build> [job-filter] [topN]");
  process.exit(1);
}

const api = async (path: string) => {
  const out = await $`bk api ${path}`.quiet();
  return JSON.parse(out.stdout.toString());
};

process.stderr.write(`fetching jobs for build ${build}...\n`);
const buildData = await api(`pipelines/bun/builds/${build}`);
const jobs = buildData.jobs.filter((j: any) => j.name && j.name.includes(jobFilter) && j.state === "passed");
process.stderr.write(`found ${jobs.length} matching jobs (${jobFilter})\n`);

// regex from buildkite-slow-tests.js
const startPattern = /_bk;t=(\d+).*?--- .*?\[90m\[(\d+)\/(\d+)\].*?\[0m (.+)/;

const totals = new Map<string, number>();

await Promise.all(
  jobs.map(async (job: any) => {
    const log = await $`bk api ${"pipelines/bun/builds/" + build + "/jobs/" + job.id + "/log"}`
      .quiet()
      .then(r => JSON.parse(r.stdout.toString()).content as string);
    let cur: string | null = null;
    let t0 = 0;
    for (const line of log.split("\n")) {
      const m = line.match(startPattern);
      if (!m) continue;
      if (cur) {
        const dur = parseInt(m[1]) - t0;
        const clean = cur.replace(/\s+\x1b\[90m\[attempt #\d+\]\x1b\[0m$/, "").trim();
        totals.set(clean, (totals.get(clean) ?? 0) + dur);
      }
      t0 = parseInt(m[1]);
      cur = m[4].trim();
    }
  }),
);

const sorted = [...totals.entries()]
  .map(([file, ms]) => ({ file, ms, sec: +(ms / 1000).toFixed(2) }))
  .sort((a, b) => b.ms - a.ms)
  .slice(0, topN);

process.stderr.write(`parsed ${totals.size} unique test files\n`);
console.log(JSON.stringify(sorted, null, 2));
