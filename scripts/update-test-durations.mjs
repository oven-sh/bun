#!/usr/bin/env node

/**
 * Regenerate test/expected-durations.json from recent Buildkite runs.
 *
 * The file maps each test path (relative to test/, forward slashes) to its
 * median per-lane cost in ms (see `lanes` below). runner.node.mjs uses it
 * to bin-pack test files across --max-shards so every shard does roughly
 * the same amount of work instead of `index % shards`.
 *
 * Usage: BUILDKITE_API_TOKEN=... node scripts/update-test-durations.mjs [--builds N]
 * Intended to be run by a scheduled Buildkite job on oven-sh/bun; it only
 * reads public build metadata and writes one file in the repo.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "..", "test", "expected-durations.json");

const { values: opts } = parseArgs({
  options: {
    builds: { type: "string", default: "5" },
    org: { type: "string", default: "bun" },
    pipeline: { type: "string", default: "bun" },
  },
});

const token = process.env.BUILDKITE_API_TOKEN || process.env.BUILDKITE_TOKEN;
if (!token) {
  console.error("BUILDKITE_API_TOKEN is required");
  process.exit(1);
}

// default + asan are both linux-x64-debian-13 (lowest-variance runner pool);
// windows and musl get their own columns because process-spawn cost and
// per-test skip behaviour differ enough from the glibc lane to leave
// 150-300s of shard spread when packed with the debian timings.
const lanes = {
  default: "linux-x64-debian-13-test-bun",
  asan: "linux-x64-asan-debian-13-test-bun",
  musl: "linux-x64-musl-alpine-324-test-bun",
  windows: "windows-x64-2019-test-bun",
};

const api = async path => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.buildkite.com/v2/organizations/${opts.org}/pipelines/${opts.pipeline}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (r.ok) return r;
    if ((r.status === 429 || r.status >= 500) && attempt < 5) {
      const backoff = Number(r.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, backoff));
      continue;
    }
    throw new Error(`${path}: ${r.status} ${r.statusText}`);
  }
};

// Per-file cost is the gap between the APC timestamps Buildkite injects into
// consecutive `[N/M] <path>` headers (ESC `_bk;t=<ms>` BEL). Serial tests
// prefix the header with `--- `; the parallel-safe phase (runner.node.mjs)
// prints the bare form. For that concurrent phase the gap is an inter-dispatch
// delta, not wall clock; we clamp it so the last-dispatched file on each shard
// does not absorb the N-wide tail drain or a sibling's 5-15 s retry backoff.
function parseLog(raw) {
  const out = [];
  const lines = raw.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/);
  let path = null;
  let start = null;
  let concurrent = false;
  const emit = ts => {
    if (path === null || start === null || ts === null) return;
    out.push([path, concurrent ? Math.min(ts - start, 500) : ts - start]);
  };
  for (let line of lines) {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const m = /^\x1b_bk;t=(\d+)\x07(.*)$/.exec(line);
    const ts = m ? Number(m[1]) : null;
    const text = m ? m[2] : line;
    const hdr = /^(--- )?\[\d+\/\d+\] (.+)$/.exec(text);
    if (hdr) {
      emit(ts);
      // Retry/error headers (`... - code 1`, `... [attempt #2]`) are not file
      // paths; treat them as a delimiter so the preceding span closes cleanly.
      const title = hdr[2].trim();
      const isPath = /\.(?:[cm]?[jt]sx?|json)$/.test(title);
      path = isPath ? title : null;
      start = isPath ? ts : null;
      concurrent = isPath && !hdr[1];
      continue;
    }
    if (/^--- (?:End\b|Running \d+ parallel-safe)/.test(text)) {
      emit(ts);
      path = start = null;
      concurrent = false;
    }
  }
  return out;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// Find recent builds where both lanes finished every shard (so the set of
// files is complete). We search passed-or-failed builds because a single
// unrelated test failure still yields complete timing for everything else.
// Note: `branch=main` is *not* applied because main builds on this pipeline
// skip the test-bun steps entirely; PR builds run the full sharded suite, and
// the median across N of them is robust to one branch's local timing changes.
async function findSourceBuilds(want) {
  const candidates = await (await api(`builds?state[]=passed&state[]=failed&per_page=100`)).json();
  const picked = [];
  for (const b of candidates) {
    const jobs = b.jobs || [];
    const ok = Object.values(lanes).every(step => {
      const laneJobs = jobs.filter(j => j.step_key === step);
      return laneJobs.length > 0 && laneJobs.every(j => j.started_at && j.finished_at && j.state !== "canceled");
    });
    if (ok) picked.push(b.number);
    if (picked.length >= want) break;
  }
  return picked;
}

async function collect(build, stepKey, into) {
  const jobs = (await (await api(`builds/${build}`)).json()).jobs.filter(
    j => j.step_key === stepKey && j.started_at && j.finished_at && j.state !== "canceled",
  );
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const j = jobs[idx++];
      if (!j) return;
      let log;
      try {
        log = await (await api(`builds/${build}/jobs/${j.id}/log.txt`)).text();
      } catch (e) {
        // A transient 429/5xx on one shard's log should not discard every
        // sample already collected; the median over the remaining builds
        // still places the file in a reasonable bin.
        console.error(`  skip job ${j.id}: ${e?.message || e}`);
        continue;
      }
      for (const [rawPath, ms] of parseLog(log)) {
        // The runner logs paths relative to the repo root; store them relative
        // to test/ to match what getRelevantTests() operates on. Vendor tests
        // are sharded separately and not included here.
        if (!rawPath.startsWith("test/")) continue;
        const key = rawPath.slice("test/".length);
        if (key === "package.json" || key.endsWith("/package.json")) continue;
        (into[key] ||= []).push(ms);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

const want = Math.max(1, parseInt(opts.builds, 10) || 5);
console.error(`looking for ${want} recent builds with complete ${Object.values(lanes).join(" + ")} lanes`);
const builds = await findSourceBuilds(want);
if (builds.length === 0) {
  console.error("no suitable builds found");
  process.exit(1);
}
console.error(`using builds: ${builds.join(", ")}`);

// lane -> path -> [ms, ...]
const samples = Object.fromEntries(Object.keys(lanes).map(lane => [lane, {}]));
for (const b of builds) {
  for (const [lane, step] of Object.entries(lanes)) {
    console.error(`  build ${b} ${lane}`);
    await collect(b, step, samples[lane]);
  }
}

const paths = new Set(Object.values(samples).flatMap(s => Object.keys(s)));
// Guard the implicit contract with utils.mjs startGroup(): if the group-header
// format ever changes, parseLog() quietly returns nothing. Fail loudly rather
// than committing an empty table that would collapse every shard onto shard 0.
if (paths.size < 1000) {
  console.error(
    `only parsed ${paths.size} test paths; expected >1000. ` +
      `This usually means the '--- [N/M] <path>' log header format changed.`,
  );
  process.exit(1);
}
const out = {
  // Consumers should tolerate missing paths (new tests) and missing lanes.
  _meta: {
    generated_at: new Date().toISOString(),
    source_builds: builds,
    lanes,
  },
};
for (const p of [...paths].sort()) {
  const entry = {};
  for (const lane of Object.keys(lanes)) {
    if (samples[lane][p]?.length) entry[lane] = median(samples[lane][p]);
  }
  out[p] = entry;
}

writeFileSync(outputPath, JSON.stringify(out, null, 2) + "\n");
console.error(`wrote ${paths.size} entries to ${outputPath}`);
