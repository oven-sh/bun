#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { prestartMap as dockerPrestartMap } from "../test/docker/prestart-map.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, "..", "test");
const outputPath = join(testDir, "parallel-allowlist.json");
const durationsPath = join(testDir, "expected-durations.json");
const denylistPath = join(testDir, "parallel-denylist.txt");

const { values: opts } = parseArgs({
  options: {
    builds: { type: "string", default: "300" },
    "fast-ms": { type: "string", default: "15000" },
    org: { type: "string", default: "bun" },
    pipeline: { type: "string", default: "bun" },
    // Append files whose flaky annotation in the scanned builds says "in the
    // parallel batch" to test/parallel-denylist.txt before generating.
    "denylist-from-annotations": { type: "boolean", default: false },
  },
});
const FAST_MS = parseInt(opts["fast-ms"], 10);
const WANT_BUILDS = parseInt(opts.builds, 10);

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

const batchFlaky = new Set();
async function collectFlakes(builds) {
  const counts = new Map();
  let done = 0;
  const queue = [...builds];
  const worker = async () => {
    for (;;) {
      const build = queue.shift();
      if (!build) return;
      const annotations = [];
      for (let page = 1; ; page++) {
        const batch = await (await api(`builds/${build}/annotations?per_page=100&page=${page}`)).json();
        annotations.push(...batch);
        if (batch.length < 100) break;
      }
      const seen = new Set();
      for (const a of annotations) {
        if (a.context !== "flaky" && a.style !== "error") continue;
        for (const m of (a.body_html || "").matchAll(/<code>test\/([^<]+)<\/code><\/a> - /g)) {
          seen.add(m[1]);
        }
        if (a.context === "flaky") {
          // "<code>test/x</code></a> - reason <i>(in the parallel batch on ..."
          for (const m of (a.body_html || "").matchAll(
            /<code>test\/([^<]+)<\/code><\/a> - [^<]*<i>\(in the parallel batch/g,
          )) {
            batchFlaky.add(m[1]);
          }
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

// Files that already failed inside the batch and passed alone. History-based
// promotion cannot see batch sensitivity for files that never ran in a batch, so
// this list is what the batch itself taught us; it only ever grows by evidence.
const denylistText = readFileSync(denylistPath, "utf8");
const denylist = new Set(
  denylistText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#")),
);
if (opts["denylist-from-annotations"]) {
  const added = [...batchFlaky].filter(file => !denylist.has(file)).sort();
  for (const file of added) denylist.add(file);
  const header = denylistText.split(/\r?\n/).filter(line => line.startsWith("#"));
  writeFileSync(denylistPath, [...header, ...[...denylist].sort()].join("\n") + "\n");
  console.error(`denylist: ${added.length} file(s) added from batch annotations (${denylist.size} total)`);
}
// prestart-map.mjs is a hint list for the shard-level service prestart, not a
// registry of every test that talks to a container, so also treat any file that
// calls describeWithContainer( as a docker-service test.
const dockerPrefixes = Object.keys(dockerPrestartMap);
const usesContainer = file => /describeWithContainer\s*\(/.test(readFileSync(join(testDir, file), "utf8"));
const files = listBunTestFiles();
// Fast on every lane we have timings for: a file that is quick on Linux but
// slow elsewhere would otherwise hold a bucket slot for its whole run.
const slowest = file => {
  const entry = durations[file];
  if (!entry) return undefined;
  const known = Object.values(entry).filter(ms => typeof ms === "number");
  return known.length ? Math.max(...known) : undefined;
};
// bun install / link / global tests share the user-level bin and cache dirs;
// run together they race on linking (EEXIST) even though each passes alone.
const sharedStatePrefixes = ["cli/install/"];
const sharedStateExempt = ["cli/install/hosted-git-info/", "cli/install/migration/"];
const isGood = file => {
  if (dockerPrefixes.some(prefix => file.startsWith(prefix)) || usesContainer(file)) return false;
  if (/stress/i.test(file)) return false;
  if (sharedStatePrefixes.some(p => file.startsWith(p)) && !sharedStateExempt.some(p => file.startsWith(p)))
    return false;
  if (flakeCounts.has(file)) return false;
  if (denylist.has(file)) return false;
  const ms = slowest(file);
  return ms === undefined || ms <= FAST_MS;
};

const byDir = new Map();
for (const file of files) {
  const slash = file.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.slice(0, slash);
  if (!byDir.has(dir)) byDir.set(dir, []);
  byDir.get(dir).push(file);
}

// Per file: a directory is listed as soon as one of its files qualifies, and
// the rest of that directory goes to excludeFiles. (The runner reads dirs +
// excludeFiles, so the shape is unchanged.)
const dirs = [];
const excludeFiles = [];
let eligibleFiles = 0;
for (const [dir, dirFiles] of [...byDir.entries()].sort()) {
  const good = dirFiles.filter(isGood);
  if (good.length === 0) continue;
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
    rule: `a bun test file qualifies when its slowest lane median in expected-durations.json is <= ${FAST_MS}ms (or it has no entry) and it had zero flaky/failed annotations in the scanned builds and is not in test/parallel-denylist.txt; docker-service (prestart-map prefixes or describeWithContainer callers), stress-named and cli/install tests (shared bin/cache dirs; hosted-git-info and migration exempt) never qualify. Every directory with a qualifying file is listed and its other files go in excludeFiles`,
    stats: { dirs: dirs.length, files: eligibleFiles, excluded: excludeFiles.length },
  },
  dirs,
  excludeFiles,
};

writeFileSync(outputPath, JSON.stringify(out, null, 2) + "\n");
console.error(
  `wrote ${outputPath}: ${dirs.length}/${byDir.size} dirs, ${eligibleFiles}/${files.length} files eligible, ${excludeFiles.length} excluded`,
);
