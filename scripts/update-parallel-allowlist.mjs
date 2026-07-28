#!/usr/bin/env node

/**
 * Regenerate test/parallel-allowlist.json: the directories whose `bun test`
 * files runner.node.mjs may batch into `bun test --parallel` buckets instead
 * of spawning one process per file.
 *
 * A directory qualifies when at least 2/3 of its files are both fast (median
 * ≤ FAST_MS on the default lane in test/expected-durations.json) and have zero
 * flaky/failed CI annotations across the last N finished PR builds. The
 * remaining files inside a qualifying directory are listed in `excludeFiles`
 * so they keep running one-at-a-time. Node-style tests (js/node/test/*,
 * js/bun/test/parallel) and docker-service directories are never included —
 * the runner schedules those separately.
 *
 * Usage: BUILDKITE_API_TOKEN=... node scripts/update-parallel-allowlist.mjs [--builds N] [--fast-ms MS]
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { prestartMap as dockerPrestartMap } from "../test/docker/prestart-map.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, "..", "test");
const outputPath = join(testDir, "parallel-allowlist.json");
const durationsPath = join(testDir, "expected-durations.json");

const { values: opts } = parseArgs({
  options: {
    builds: { type: "string", default: "300" },
    "fast-ms": { type: "string", default: "15000" },
    org: { type: "string", default: "bun" },
    pipeline: { type: "string", default: "bun" },
  },
});
const FAST_MS = parseInt(opts["fast-ms"], 10);
const WANT_BUILDS = parseInt(opts.builds, 10);
// A directory qualifies when at least this fraction of its files do; the
// stragglers go into excludeFiles instead of costing the whole directory.
const DIR_MIN_FRACTION = 2 / 3;

const token = process.env.BUILDKITE_API_TOKEN || process.env.BUILDKITE_TOKEN;
if (!token) {
  console.error("BUILDKITE_API_TOKEN is required");
  process.exit(1);
}

const api = async path => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.buildkite.com/v2/organizations/${opts.org}/pipelines/${opts.pipeline}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (r.ok) return r;
    if ((r.status === 429 || r.status >= 500) && attempt < 8) {
      const backoff = Number(r.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, backoff));
      continue;
    }
    throw new Error(`${path}: ${r.status} ${r.statusText}`);
  }
};

// Test file discovery mirrors getTests()/isTestStrict() in runner.node.mjs so
// the directory set matches what a shard actually enumerates.
const isNodeStyle = p =>
  p.includes("js/node/test/parallel/") || p.includes("js/node/test/sequential/") || p.includes("js/bun/test/parallel/");
function listBunTestFiles() {
  const out = [];
  const walk = rel => {
    for (const entry of readdirSync(join(testDir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (/node_modules|node\.js/.test(rel) || /^\./.test(entry.name)) continue;
      if (entry.isDirectory()) walk(path);
      else if (/\.(c|m)?(j|t)sx?$/.test(entry.name) && /\.test|spec\./.test(entry.name) && !isNodeStyle(path)) {
        out.push(path);
      }
    }
  };
  walk("");
  return out.sort();
}

// Recent finished PR builds that ran the sharded test-bun steps. One
// annotations request per build gives every flaky (passed on retry) and
// failed test file that build reported, across all platforms.
async function findBuilds(want) {
  const picked = [];
  for (let page = 1; picked.length < want && page <= 25; page++) {
    const batch = await (await api(`builds?state[]=passed&state[]=failed&per_page=100&page=${page}`)).json();
    if (!batch.length) break;
    for (const b of batch) {
      if (!b.pull_request) continue;
      const testJobs = (b.jobs || []).filter(j => j.step_key?.endsWith("test-bun") && j.finished_at);
      if (testJobs.length >= 50) picked.push(b.number);
      if (picked.length >= want) break;
    }
    console.error(`  build page ${page}: ${picked.length}/${want}`);
  }
  return picked;
}

// file (relative to test/) -> number of builds in which it flaked or failed
async function collectFlakes(builds) {
  const counts = new Map();
  let done = 0;
  const queue = [...builds];
  const worker = async () => {
    for (;;) {
      const build = queue.shift();
      if (!build) return;
      let annotations;
      try {
        annotations = await (await api(`builds/${build}/annotations?per_page=100`)).json();
      } catch (e) {
        console.error(`  skip build ${build}: ${e?.message || e}`);
        continue;
      }
      const seen = new Set();
      for (const a of annotations) {
        if (a.context !== "flaky" && a.style !== "error") continue;
        // Each failing/flaky file is a <details> block whose summary links the
        // path as <code>test/...</code>; see reportAnnotationToBuildKite().
        for (const m of (a.body_html || "").matchAll(/<code>test\/([^<]+)<\/code><\/a> - /g)) {
          seen.add(m[1]);
        }
      }
      for (const file of seen) counts.set(file, (counts.get(file) || 0) + 1);
      if (++done % 50 === 0) console.error(`  annotations ${done}/${builds.length}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return counts;
}

let durations = {};
try {
  durations = JSON.parse(readFileSync(durationsPath, "utf8"));
} catch (e) {
  console.error(`could not read ${durationsPath}: ${e?.message || e}`);
  process.exit(1);
}

console.error(`finding ${WANT_BUILDS} recent finished PR builds...`);
const builds = await findBuilds(WANT_BUILDS);
if (builds.length < 50) {
  console.error(`only found ${builds.length} builds; refusing to generate an allowlist from that little history`);
  process.exit(1);
}
console.error(`scanning annotations from ${builds.length} builds (#${Math.min(...builds)}..#${Math.max(...builds)})`);
const flakeCounts = await collectFlakes(builds);
console.error(`${flakeCounts.size} distinct files flaked or failed in that window`);

const dockerPrefixes = Object.keys(dockerPrestartMap);
const files = listBunTestFiles();
const isGood = file => {
  if (dockerPrefixes.some(prefix => file.startsWith(prefix))) return false;
  // Stress tests saturate a machine on their own; running one alongside
  // other workers is what makes it (or its neighbours) time out.
  if (/stress/i.test(file)) return false;
  if (flakeCounts.has(file)) return false;
  const ms = durations[file]?.default;
  // Files without a recorded duration are new; give them the benefit of the
  // doubt so a fresh test in an allowlisted directory doesn't need a regen.
  return ms === undefined || ms <= FAST_MS;
};

const byDir = new Map();
for (const file of files) {
  const dir = file.slice(0, file.lastIndexOf("/"));
  if (!byDir.has(dir)) byDir.set(dir, []);
  byDir.get(dir).push(file);
}

const dirs = [];
const excludeFiles = [];
let eligibleFiles = 0;
for (const [dir, dirFiles] of [...byDir.entries()].sort()) {
  const good = dirFiles.filter(isGood);
  if (good.length < Math.max(1, Math.ceil(dirFiles.length * DIR_MIN_FRACTION))) continue;
  dirs.push(dir);
  eligibleFiles += good.length;
  for (const f of dirFiles) if (!isGood(f)) excludeFiles.push(f);
}

const out = {
  _meta: {
    generated_at: new Date().toISOString(),
    generated_by: "scripts/update-parallel-allowlist.mjs",
    builds_scanned: builds.length,
    build_range: [Math.min(...builds), Math.max(...builds)],
    fast_ms: FAST_MS,
    rule: `a directory is listed when >= ${Math.round(DIR_MIN_FRACTION * 100)}% of its bun test files are <= ${FAST_MS}ms (median, default lane of expected-durations.json) with zero flaky/failed annotations in the scanned builds; its other files are listed in excludeFiles; docker-service and stress-named tests never qualify`,
    stats: { dirs: dirs.length, files: eligibleFiles, excluded: excludeFiles.length },
  },
  dirs,
  excludeFiles,
};

writeFileSync(outputPath, JSON.stringify(out, null, 2) + "\n");
console.error(
  `wrote ${outputPath}: ${dirs.length}/${byDir.size} dirs, ${eligibleFiles}/${files.length} files eligible, ${excludeFiles.length} excluded`,
);
