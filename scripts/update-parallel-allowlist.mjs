#!/usr/bin/env node

import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { prestartMap as dockerPrestartMap } from "../test/docker/prestart-map.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testDir = join(__dirname, "..", "test");
const outputPath = join(testDir, "parallel-allowlist.json");
const durationsPath = join(testDir, "expected-durations.json");

const DIR_MIN_FRACTION = 2 / 3;

// Pure: given the scan inputs, compute the {dirs, excludeFiles} table.
// Exported for test/internal/parallel-allowlist.test.ts so the carry-forward
// rule below is covered without hitting the Buildkite API.
export function computeAllowlist({ files, flaky, durations, previousExcludes, dockerPrefixes, fastMs }) {
  const isGood = file => {
    if (dockerPrefixes.some(prefix => file.startsWith(prefix))) return false;
    if (/stress/i.test(file)) return false;
    // A file already in excludeFiles never runs inside the parallel batch, so
    // the annotation scan cannot observe it flaking there; "zero flakes" is
    // not evidence it became batch-safe. Carry the exclusion forward. To drop
    // one, remove it from parallel-allowlist.json by hand; the next regen then
    // has real batch data for it and re-excludes only if it flakes again.
    if (previousExcludes.has(file)) return false;
    if (flaky.has(file)) return false;
    const ms = durations[file]?.default;
    return ms === undefined || ms <= fastMs;
  };

  const byDir = new Map();
  for (const file of files) {
    const slash = file.lastIndexOf("/");
    const dir = slash === -1 ? "" : file.slice(0, slash);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(file);
  }

  const dirs = [];
  const excludeFiles = [];
  let eligibleFiles = 0;
  for (const [dir, dirFiles] of [...byDir.entries()].sort()) {
    // Threshold is computed over files with fresh evidence only: a carried
    // exclude has no batch data in this window, so letting it count against
    // dir eligibility can drop the dir, which drops its carried excludes and
    // recreates the ping-pong at the dir level.
    const fresh = dirFiles.filter(f => !previousExcludes.has(f));
    const good = fresh.filter(isGood);
    if (good.length < Math.max(1, Math.ceil(fresh.length * DIR_MIN_FRACTION))) continue;
    dirs.push(dir);
    eligibleFiles += good.length;
    for (const f of dirFiles) if (!isGood(f)) excludeFiles.push(f);
  }

  return { dirs, excludeFiles, eligibleFiles, totalDirs: byDir.size };
}

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

if (process.argv[1] && realpathSync(process.argv[1]) === __filename) {
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

  const token = process.env.BUILDKITE_API_TOKEN || process.env.BUILDKITE_TOKEN;
  if (!token) {
    console.error("BUILDKITE_API_TOKEN is required");
    process.exit(1);
  }

  const api = async path => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(
        `https://api.buildkite.com/v2/organizations/${opts.org}/pipelines/${opts.pipeline}/${path}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (r.ok) return r;
      if ((r.status === 429 || r.status >= 500) && attempt < 8) {
        const backoff = Number(r.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      throw new Error(`${path}: ${r.status} ${r.statusText}`);
    }
  };

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

  let previousExcludes = new Set();
  try {
    const prev = JSON.parse(readFileSync(outputPath, "utf8")).excludeFiles;
    if (!Array.isArray(prev)) throw new Error("excludeFiles is not an array");
    previousExcludes = new Set(prev);
  } catch (e) {
    if (e?.code !== "ENOENT") {
      console.error(`could not read previous ${outputPath}: ${e?.message || e}`);
      process.exit(1);
    }
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

  const files = listBunTestFiles();
  const { dirs, excludeFiles, eligibleFiles, totalDirs } = computeAllowlist({
    files,
    flaky: flakeCounts,
    durations,
    previousExcludes,
    dockerPrefixes: Object.keys(dockerPrestartMap),
    fastMs: FAST_MS,
  });

  const out = {
    _meta: {
      generated_at: new Date().toISOString(),
      generated_by: "scripts/update-parallel-allowlist.mjs",
      builds_scanned: builds.length,
      build_range: [Math.min(...builds), Math.max(...builds)],
      fast_ms: FAST_MS,
      rule: `a directory is listed when >= ${Math.round(DIR_MIN_FRACTION * 100)}% of its bun test files are <= ${FAST_MS}ms (median, default lane of expected-durations.json) with zero flaky/failed annotations in the scanned builds; its other files are listed in excludeFiles; docker-service and stress-named tests never qualify; previous excludeFiles are carried forward (no batch data while excluded)`,
      stats: { dirs: dirs.length, files: eligibleFiles, excluded: excludeFiles.length },
    },
    dirs,
    excludeFiles,
  };

  writeFileSync(outputPath, JSON.stringify(out, null, 2) + "\n");
  console.error(
    `wrote ${outputPath}: ${dirs.length}/${totalDirs} dirs, ${eligibleFiles}/${files.length} files eligible, ${excludeFiles.length} excluded`,
  );
}
