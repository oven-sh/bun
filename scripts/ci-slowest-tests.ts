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
//   bun scripts/ci-slowest-tests.ts --allow-partial # exit 0 even if some job logs are missing
//
// Exit code 2 means that some job logs could not be fetched. The output is
// there, but it is computed from partial data (`jobsFailed` in the JSON). Run
// the same command again: only the missing logs are fetched.
//
// Requires BUILDKITE_TOKEN (or BUILDKITE_API_TOKEN) and `bk` + `gh` CLIs.

import { $, spawn } from "bun";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { retryDelayMs } from "./buildkite-retry.mjs";
import { isPhaseGroupHeader } from "./ci-log-phase.mjs";

// Per-file cost is the gap between the APC timestamps Buildkite injects into
// consecutive `[N/M] <path>` headers (ESC `_bk;t=<ms>` BEL). See
// scripts/ci-log-phase.mjs for the header shapes runner.node.mjs emits and why
// each one has to close the open span.
export function parseLog(text: string): Map<string, number> {
  const out = new Map<string, number>();
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
    out.set(curName, (out.get(curName) ?? 0) + (concurrent ? Math.min(span, 500) : span));
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
        out.set(timed[1], (out.get(timed[1]) ?? 0) + Math.round(parseFloat(timed[2]) * 1000));
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
    if (isPhaseGroupHeader(body)) {
      close(ts);
      concurrent = false;
    }
  }
  // A truncated log (job killed / timed out mid-run) has no `--- End`; charge
  // the open span to the last timestamp seen so the culprit is not dropped.
  close(lastTs);
  return out;
}

export type Job = { id: string; name: string; raw_log_url: string; retried?: boolean };

export type LogFetcherOptions = {
  token: string;
  /** Holds one `<job id>.log` per fetched log, so a re-run only fetches what is missing. */
  cacheDir: string;
  /** Requests per log, the first one included. */
  maxAttempts?: number;
  /** Upper bound for one wait. A wait that the response asks for gets one second on top. */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
};

function announceAndSleep(ms: number) {
  console.error(`  waiting ${ms / 1000}s for Buildkite (rate limit or server error)`);
  return Bun.sleep(ms);
}

// Do NOT use `bk job log`: it hangs indefinitely on some Windows/alpine jobs.
// Fetching raw_log_url directly with the token works for all of them.
//
// One build has about 160 test-bun jobs and Buildkite allows 200 requests per
// minute, shared by every user of the token, so a 429 is routine. On a 429 or a
// 5xx, wait (scripts/buildkite-retry.mjs says how long) and ask again. The wait
// is shared: one 429 holds back every download, not only the one that received
// it.
export function createLogFetcher({
  token,
  cacheDir,
  maxAttempts = 6,
  maxWaitMs = 60_000,
  sleep = announceAndSleep,
}: LogFetcherOptions) {
  let pause: Promise<unknown> | null = null;
  return async function fetchLog(job: Job): Promise<string> {
    const path = join(cacheDir, `${job.id}.log`);
    if (existsSync(path)) return readFileSync(path, "utf8");
    for (let attempt = 1; ; attempt++) {
      while (pause) await pause;
      const res = await fetch(job.raw_log_url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const out = await res.text();
        writeFileSync(path, out);
        return out;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`${res.status} ${job.raw_log_url}` + (attempt > 1 ? ` (${attempt} attempts)` : ""));
      }
      const wait = await retryDelayMs(res, attempt, maxWaitMs);
      pause ??= sleep(wait).finally(() => (pause = null));
    }
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const allowPartial = args.includes("--allow-partial");
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

  const fetchLog = createLogFetcher({ token: TOKEN, cacheDir: CACHE });

  type Agg = { maxMs: number; maxPlat: string; perPlat: Map<string, number> };
  const agg = new Map<string, Agg>();

  let done = 0;
  const failedJobs: { id: string; platform: string; error: string }[] = [];
  const queue = [...jobs];
  async function worker() {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      try {
        const log = await fetchLog(job);
        const plat = platOf(job.name);
        for (const [file, ms] of parseLog(log)) {
          let a = agg.get(file);
          if (!a) agg.set(file, (a = { maxMs: 0, maxPlat: "", perPlat: new Map() }));
          const total = (a.perPlat.get(plat) ?? 0) + ms;
          a.perPlat.set(plat, total);
          if (total > a.maxMs) {
            a.maxMs = total;
            a.maxPlat = plat;
          }
        }
        done++;
      } catch (e) {
        const error = (e as Error).message;
        console.error(`  failed ${job.id}: ${error}`);
        failedJobs.push({ id: job.id, platform: platOf(job.name), error });
      }
      const settled = done + failedJobs.length;
      if (settled % 20 === 0 || settled === jobs.length) {
        console.error(`  ${done}/${jobs.length} logs` + (failedJobs.length ? `, ${failedJobs.length} failed` : ""));
      }
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));

  // `package.json` / `test/package.json` are setup steps, not tests.
  const isTest = (f: string) => /\.(m|c)?(j|t)sx?$/.test(f);

  const sorted = [...agg.entries()]
    .filter(([file]) => isTest(file))
    .map(([file, a]) => ({ file, maxMs: a.maxMs, maxPlat: a.maxPlat }))
    .sort((a, b) => b.maxMs - a.maxMs)
    .slice(0, TOP_N);

  console.error(`${agg.size} unique entries, ${sorted.length} test files after filtering`);
  console.error(`logs cached at ${CACHE}`);

  if (json) {
    const report = {
      build: BUILD,
      count: agg.size,
      top: sorted,
      jobs: jobs.length,
      jobsFailed: failedJobs.length,
      failedJobs,
    };
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`rank\tseconds\tfile\tslowest_platform`);
    sorted.forEach((t, i) => console.log(`${i + 1}\t${(t.maxMs / 1000).toFixed(2)}\t${t.file}\t${t.maxPlat}`));
  }

  // After the table, so that it is the last thing on a terminal.
  if (failedJobs.length) {
    const perPlat = new Map<string, number>();
    for (const { platform } of failedJobs) perPlat.set(platform, (perPlat.get(platform) ?? 0) + 1);
    console.error(
      `warning: ${failedJobs.length} of ${jobs.length} logs are missing, so the result is computed from partial data\n` +
        `  missing: ${[...perPlat].map(([plat, n]) => `${plat} (${n})`).join(", ")}\n` +
        `  run the same command again to fetch only the missing logs`,
    );
  }
  process.exit(failedJobs.length && !allowPartial ? 2 : 0);
}
