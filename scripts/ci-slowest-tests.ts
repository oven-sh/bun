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

// Per-file cost is the gap between the APC timestamps Buildkite injects into
// consecutive `[N/M] <path>` headers (ESC `_bk;t=<ms>` BEL). Serial-phase
// tests print `--- [N/M] path` via startGroup; the parallel-safe phase
// (runner.node.mjs runTest with concurrent=true) prints the bare `[N/M] path`
// without `--- `. If the `--- ` is treated as mandatory the last serial test
// on every shard absorbs the entire parallel phase's wall clock.
export function parseLog(text: string): Map<string, number> {
  const out = new Map<string, number>();
  let curName: string | null = null;
  let curStart = 0;
  let concurrent = false;
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
    const ts = parseInt(apc[1], 10);
    const body = apc[2].replace(/\x1b\[[0-9;]*m/g, "").replace(/\r+$/, "");
    const hdr = /^(--- )?\[\d+\/\d+\] (.+)$/.exec(body);
    if (hdr) {
      close(ts);
      const title = hdr[2].replace(/ \[attempt #\d+\]$/, "").replace(/\\/g, "/").trim();
      // Retry/error labels (`<path> - code 1`) are not file paths; treat them
      // as a delimiter so the preceding span closes without the retry backoff
      // landing on either attempt.
      const isPath = /\.(?:[cm]?[jt]sx?|json)$/.test(title);
      curName = isPath ? title : null;
      curStart = ts;
      concurrent = !hdr[1];
      continue;
    }
    if (/^--- (?:End\b|Running \d+ parallel-safe)/.test(body)) close(ts);
  }
  return out;
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
  console.error(`build #${BUILD}: ${jobs.length} test-bun jobs across ${new Set(jobs.map(j => j.name)).size} platforms`);

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

  type Agg = { maxMs: number; maxPlat: string; perPlat: Map<string, number> };
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
      } catch (e) {
        console.error(`  failed ${job.id}: ${(e as Error).message}`);
      }
      done++;
      if (done % 20 === 0 || done === jobs.length) console.error(`  ${done}/${jobs.length} logs`);
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
    console.log(JSON.stringify({ build: BUILD, count: agg.size, top: sorted }, null, 2));
  } else {
    console.log(`rank\tseconds\tfile\tslowest_platform`);
    sorted.forEach((t, i) => console.log(`${i + 1}\t${(t.maxMs / 1000).toFixed(2)}\t${t.file}\t${t.maxPlat}`));
  }
  process.exit(0);
}
