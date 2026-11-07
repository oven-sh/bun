#!/usr/bin/env bun
// Find the slowest test files in a CI build.
//
// Downloads every test-bun job log from a BuildKite build, parses per-file
// wall-clock from the `_bk;t=<ms>` timestamps that prefix each
// `[N/TOTAL] <file>` header, aggregates as MAX across all platforms, and
// prints the top N.
//
// Usage:
//   bun scripts/ci-slowest-tests.ts                 # auto-pick a recent merged-PR build, top 500
//   bun scripts/ci-slowest-tests.ts 47324           # specific build
//   bun scripts/ci-slowest-tests.ts 47324 100       # top 100
//   bun scripts/ci-slowest-tests.ts --json          # JSON output
//
// Requires BUILDKITE_TOKEN (or BUILDKITE_API_TOKEN) and `bk` + `gh` CLIs.

import { $, spawn } from "bun";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { failedBucketAttempt, isPhaseGroupHeader } from "./ci-log-phase.mjs";

// Per-file cost is the gap between the APC timestamps Buildkite injects into
// consecutive `[N/M] <path>` headers (ESC `_bk;t=<ms>` BEL). See
// scripts/ci-log-phase.mjs for the header shapes runner.node.ts emits and why
// each one has to close the open span.
//
// `record` gets each attempt of a file in the log, with what that attempt
// took. An attempt is a serial run (the first, or an `[attempt #K]`), a run in
// a parallel bucket whether it passed or failed there, or a dispatch of the
// parallel-safe phase. In the phase of the files that build many executables
// this loop times only a file that passes at its first try (`[N/M] <path>
// (X.XXs)`): a first try that fails is no attempt, and a further try counts
// like a parallel-safe dispatch, at most 500 ms.
function eachAttempt(text: string, record: (file: string, ms: number) => void): void {
  let curName: string | null = null;
  let curStart = 0;
  let concurrent = false;
  let lastTs = 0;
  const close = (ts: number) => {
    if (!curName) return;
    const span = ts - curStart;
    // Concurrent-phase gaps are inter-dispatch deltas, not per-file wall
    // clock; clamp so the last-dispatched file on a shard does not absorb the
    // N-wide tail drain or a sibling's 5-15 s retry backoff.
    record(curName, concurrent ? Math.min(span, 500) : span);
    curName = null;
  };
  for (const line of text.split("\n")) {
    const apc = /_bk;t=(\d+)\x07(.*)/.exec(line);
    if (!apc) continue;
    const ts = (lastTs = parseInt(apc[1], 10));
    const body = apc[2].replace(/\x1b\[[0-9;]*m/g, "").replace(/\r+$/, "");
    const hdr = /^(--- )?\[\d+\/\d+\] (.+)$/.exec(body);
    if (hdr) {
      close(ts);
      const title = hdr[2]
        .replace(/ \[attempt #\d+\]$/, "")
        .replace(/\\/g, "/")
        .trim();
      // Parallel-bucket summaries carry the authoritative wall clock inline.
      const timed = !hdr[1] && /^(.+\.(?:[cm]?[jt]sx?|json)) \((\d+(?:\.\d+)?)s\)$/.exec(title);
      if (timed) {
        record(timed[1], Math.round(parseFloat(timed[2]) * 1000));
        concurrent = false;
        continue;
      }
      // Retry/error labels (`<path> - code 1`) are not file paths; treat them
      // as a delimiter so the preceding span closes without the retry backoff
      // landing on either attempt.
      const isPath = /\.(?:[cm]?[jt]sx?|json)$/.test(title);
      curName = isPath ? title : null;
      curStart = ts;
      concurrent = !hdr[1];
      continue;
    }
    // The runner's other headers are groups.
    if (!body.startsWith("--- ")) continue;
    const failed = failedBucketAttempt(body);
    if (failed) {
      close(ts);
      record(failed.path, failed.ms);
    } else if (isPhaseGroupHeader(body)) {
      close(ts);
      concurrent = false;
    }
  }
  // A truncated log (job killed / timed out mid-run) has no `--- End`; charge
  // the open span to the last timestamp seen so the culprit is not dropped.
  close(lastTs);
}

// One file over the jobs of a build. `perPlat` is the sum of the file's
// attempts on each platform. `retried` has the platforms where that sum is
// more than one attempt.
export type Agg = {
  maxMs: number;
  maxPlat: string;
  perPlat: Map<string, number>;
  retried?: Map<string, { attempts: number; maxAttemptMs: number }>;
};

// `maxMs` is the sum of `attempts` attempts on `maxPlat`, the platform where
// the file took the longest. The longest of them took `maxAttemptMs`. More
// than one attempt is a file that failed and ran again, not one slow run.
export type Row = { file: string; maxMs: number; maxPlat: string; attempts: number; maxAttemptMs: number };

export function addLog(agg: Map<string, Agg>, plat: string, log: string): void {
  eachAttempt(log, (file, ms) => {
    let a = agg.get(file);
    if (!a) agg.set(file, (a = { maxMs: 0, maxPlat: "", perPlat: new Map() }));
    const before = a.perPlat.get(plat);
    const total = (before ?? 0) + ms;
    a.perPlat.set(plat, total);
    if (before !== undefined) {
      const retried = (a.retried ??= new Map());
      const onPlat = retried.get(plat);
      if (onPlat) {
        onPlat.attempts++;
        onPlat.maxAttemptMs = Math.max(onPlat.maxAttemptMs, ms);
      } else {
        // Until now the sum was one attempt.
        retried.set(plat, { attempts: 2, maxAttemptMs: Math.max(before, ms) });
      }
    }
    if (total > a.maxMs) {
      a.maxMs = total;
      a.maxPlat = plat;
    }
  });
}

// `package.json` / `test/package.json` are setup steps, not tests.
const isTest = (f: string) => /\.(m|c)?(j|t)sx?$/.test(f);

export function slowestRows(agg: Map<string, Agg>, topN: number): Row[] {
  return [...agg.entries()]
    .filter(([file]) => isTest(file))
    .map(([file, a]) => {
      const retried = a.retried?.get(a.maxPlat);
      return {
        file,
        maxMs: a.maxMs,
        maxPlat: a.maxPlat,
        attempts: retried?.attempts ?? 1,
        maxAttemptMs: retried?.maxAttemptMs ?? a.maxMs,
      };
    })
    .sort((a, b) => b.maxMs - a.maxMs)
    .slice(0, topN);
}

export function tableLines(rows: Row[]): string[] {
  const seconds = (ms: number) => (ms / 1000).toFixed(2);
  return [
    `rank\tseconds\tfile\tslowest_platform\tattempts\tlongest_attempt`,
    ...rows.map(
      (row, i) =>
        `${i + 1}\t${seconds(row.maxMs)}\t${row.file}\t${row.maxPlat}\t${row.attempts}\t${seconds(row.maxAttemptMs)}`,
    ),
  ];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const positional = args.filter(a => !a.startsWith("-"));
  let BUILD = positional[0];
  const TOP_N = parseInt(positional[1] || "500", 10);

  const TOKEN = process.env.BUILDKITE_TOKEN || process.env.BUILDKITE_API_TOKEN;
  if (!TOKEN) {
    console.error("error: BUILDKITE_TOKEN not set");
    process.exit(1);
  }

  // Auto-pick a build: most-recent merged PR whose branch has a finished build.
  // Merged-PR builds usually report state=failed (flaky tests) — that's fine,
  // we only need the timing data.
  if (!BUILD) {
    console.error("no build given, finding a recent merged-PR build...");
    const prs = await $`gh pr list --state merged --limit 10 --json number,headRefName`.json();
    for (const pr of prs) {
      const builds = await $`bk build list --branch ${pr.headRefName}`
        .quiet()
        .json()
        .catch(() => []);
      const done = builds.find((b: any) => b.finished_at && b.state !== "canceled" && b.state !== "running");
      if (done) {
        BUILD = String(done.number);
        console.error(`  using build #${BUILD} (PR #${pr.number}, ${pr.headRefName}, state=${done.state})`);
        break;
      }
    }
    if (!BUILD) {
      console.error("error: no finished build found among the last 10 merged PRs");
      process.exit(1);
    }
  }

  const CACHE = join(tmpdir(), `bun-ci-logs-${BUILD}`);
  mkdirSync(CACHE, { recursive: true });

  type Job = { id: string; name: string; raw_log_url: string; retried?: boolean };

  const buildJson = JSON.parse(
    await new Response(spawn({ cmd: ["bk", "build", "view", BUILD], stdout: "pipe" }).stdout).text(),
  );
  const jobs: Job[] = buildJson.jobs.filter(
    (j: any) => j.name && j.raw_log_url && j.name.includes("test-bun") && !j.retried,
  );
  console.error(
    `build #${BUILD}: ${jobs.length} test-bun jobs across ${new Set(jobs.map(j => j.name)).size} platforms`,
  );

  const platOf = (name: string) =>
    name
      .replace(/ - test-bun$/, "")
      .replace(/^:([a-z]+):/, "$1")
      .trim();

  // Do NOT use `bk job log` — it hangs indefinitely on some Windows/alpine jobs.
  // Fetching raw_log_url directly with the token works for all of them.
  async function fetchLog(job: Job): Promise<string> {
    const path = join(CACHE, `${job.id}.log`);
    if (existsSync(path)) return readFileSync(path, "utf8");
    const res = await fetch(job.raw_log_url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`${res.status} ${job.raw_log_url}`);
    const out = await res.text();
    writeFileSync(path, out);
    return out;
  }

  const agg = new Map<string, Agg>();

  let done = 0;
  const queue = [...jobs];
  async function worker() {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      try {
        const log = await fetchLog(job);
        const plat = platOf(job.name);
        addLog(agg, plat, log);
      } catch (e) {
        console.error(`  failed ${job.id}: ${(e as Error).message}`);
      }
      done++;
      if (done % 20 === 0 || done === jobs.length) console.error(`  ${done}/${jobs.length} logs`);
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));

  const sorted = slowestRows(agg, TOP_N);

  console.error(`${agg.size} unique entries, ${sorted.length} test files after filtering`);
  console.error(`logs cached at ${CACHE}`);

  if (json) {
    console.log(JSON.stringify({ build: BUILD, count: agg.size, top: sorted }, null, 2));
  } else {
    for (const line of tableLines(sorted)) console.log(line);
  }
  process.exit(0);
}
