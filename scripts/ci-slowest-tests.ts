#!/usr/bin/env bun
// Find the slowest test files in a CI build.
//
// Downloads every test-bun job log from a BuildKite build, parses per-file
// wall-clock from the `_bk;t=<ms>` timestamps that prefix each
// `[N/TOTAL] <file>` header, subtracts the time a file spent blocked on
// docker-compose container start-up (reported separately: it is a property of
// the shard, not of the file), aggregates as MAX across all platforms, and
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
import { prestartMap } from "../test/docker/prestart-map.mjs";

// Per-file cost is the gap between the APC timestamps Buildkite injects into
// consecutive `[N/M] <path>` headers (ESC `_bk;t=<ms>` BEL). runner.node.mjs
// emits several header shapes that must each close the open span:
//   - serial test start: `--- [N/M] <path>` (startGroup)
//   - retry/error label: `--- [N/M] <path> - <error>` (not a path)
//   - parallel-bucket phase: `--- [A-B/M] K files in parallel`, then after the
//     single `bun test --parallel` run a summary `[N/M] <path> (X.XXs)` per file
//   - parallel-safe phase: `--- Running N parallel-safe tests`, then a bare
//     `[N/M] <path>` per concurrent dispatch (no recoverable wall clock)
//   - other startGroup phases: `--- napi prebuild: ...`, `--- End`
// A parser that only recognises the first shape folds the entire following
// phase into whichever serial test happened to precede it.
//
// runner.node.mjs's pipeTestStdout sanitises `--- ` in streamed test output,
// but a chunk boundary mid-token or one of the raw-write paths (coordinator
// stdout, retry stdoutPreview) can still deliver a line that starts `--- `
// without being a group header (unified-diff `--- a/<file>`, `--- ps ---`).
// The boundary check is therefore limited to the phase headers runner.node.mjs
// actually emits rather than any `--- `.
export const isPhaseGroupHeader = (body: string) =>
  /^--- (?:\[\d+-\d+\/\d+\]|napi prebuild:|Running \d+ parallel-safe|End\b|Summary\b|Received \w+, exiting)/.test(body);

// awaitService (test/docker/index.ts; describeWithContainer goes through it)
// prints this from the test process with how long it sat blocked waiting for
// docker-compose to bring the service up. That wait is inside the file's
// measured time, so the first file on a shard to touch a cold service would
// otherwise rank as a 15-40 s test. The reported number is the only usable
// signal: the line's timestamp is not, since a file with several container
// describes runs real tests between its lines. Unanchored because bun's
// progress dots can precede it on the same physical line.
export const containerWaitLine = /Container ready via docker-compose: .*\(waited (\d+)ms\)/;

// Inside the parallel bucket, `bun test --parallel` flushes each file's output
// as one block introduced by `<path>:`, which is the only way to tell whose
// wait a line in that phase is.
const bucketOutputHeader = /^(\S+\.(?:[cm]?[jt]sx?)):$/;

/** `ms` is what the file is charged: its measured time minus `containerMs`. */
export type FileCost = { ms: number; containerMs: number };

export function parseLog(text: string): Map<string, FileCost> {
  const out = new Map<string, FileCost>();
  const add = (name: string, ms: number, containerMs = 0) => {
    const cost = out.get(name);
    if (cost) {
      cost.ms += ms;
      cost.containerMs += containerMs;
    } else {
      out.set(name, { ms, containerMs });
    }
  };
  let curName: string | null = null;
  let curStart = 0;
  let curContainerMs = 0;
  let concurrent = false;
  let lastTs = 0;
  // Bucket phase: the file whose output block is streaming, and the waits
  // reported so far, to take off each file's summary line once it arrives.
  let inBucket = false;
  let bucketFile: string | null = null;
  const bucketWaits = new Map<string, number>();
  const close = (ts: number) => {
    if (!curName) return;
    const span = Math.max(0, ts - curStart - curContainerMs);
    // Concurrent-phase gaps are inter-dispatch deltas, not per-file wall
    // clock; clamp so the last-dispatched file on a shard does not absorb the
    // N-wide tail drain or a sibling's 5-15 s retry backoff.
    add(curName, concurrent ? Math.min(span, 500) : span, curContainerMs);
    curName = null;
    curContainerMs = 0;
  };
  for (const line of text.split("\n")) {
    const apc = /_bk;t=(\d+)\x07(.*)/.exec(line);
    if (!apc) continue;
    const ts = (lastTs = parseInt(apc[1], 10));
    const body = apc[2].replace(/\x1b\[[0-9;]*m/g, "").replace(/\r+$/, "");
    const hdr = /^(--- )?\[\d+\/\d+\] (.+)$/.exec(body);
    if (hdr) {
      close(ts);
      inBucket = false;
      bucketFile = null;
      const title = hdr[2]
        .replace(/ \[attempt #\d+\]$/, "")
        .replace(/\\/g, "/")
        .trim();
      // Parallel-bucket summaries carry the authoritative time inline: bun's
      // junit figure for the file, which includes the hooks or not depending on
      // which <testsuite> runner.node.mjs reads (#37483). Taking the file's
      // reported wait off it, floored at 0, is its own time either way.
      const timed = !hdr[1] && /^(.+\.(?:[cm]?[jt]sx?|json)) \((\d+(?:\.\d+)?)s\)$/.exec(title);
      if (timed) {
        const waited = bucketWaits.get(timed[1]) ?? 0;
        bucketWaits.delete(timed[1]);
        add(timed[1], Math.max(0, Math.round(parseFloat(timed[2]) * 1000) - waited));
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
      // `[N/M]` headers were handled above, so `--- [` here is the bucket's
      // `[A-B/M] K files in parallel`.
      inBucket = body.startsWith("--- [");
      bucketFile = null;
      continue;
    }
    if (inBucket) {
      const block = bucketOutputHeader.exec(body);
      if (block) {
        bucketFile = block[1].replace(/\\/g, "/");
        continue;
      }
    }
    const wait = containerWaitLine.exec(body);
    if (!wait) continue;
    const waited = parseInt(wait[1], 10);
    if (curName) {
      curContainerMs += waited;
    } else if (bucketFile) {
      add(bucketFile, 0, waited);
      bucketWaits.set(bucketFile, (bucketWaits.get(bucketFile) ?? 0) + waited);
    }
  }
  // A truncated log (job killed / timed out mid-run) has no `--- End`; charge
  // the open span to the last timestamp seen so the culprit is not dropped.
  close(lastTs);
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

  // maxMs/maxPlat rank the file; maxContainerMs/containerPlat is the longest it sat
  // waiting for a container on any platform, reported but not ranked.
  type Agg = {
    maxMs: number;
    maxPlat: string;
    maxContainerMs: number;
    containerPlat: string;
    perPlat: Map<string, FileCost>;
  };
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
        for (const [file, { ms, containerMs }] of parseLog(log)) {
          let a = agg.get(file);
          if (!a)
            agg.set(file, (a = { maxMs: 0, maxPlat: "", maxContainerMs: 0, containerPlat: "", perPlat: new Map() }));
          let total = a.perPlat.get(plat);
          if (!total) a.perPlat.set(plat, (total = { ms: 0, containerMs: 0 }));
          total.ms += ms;
          total.containerMs += containerMs;
          if (total.ms > a.maxMs) {
            a.maxMs = total.ms;
            a.maxPlat = plat;
          }
          if (total.containerMs > a.maxContainerMs) {
            a.maxContainerMs = total.containerMs;
            a.containerPlat = plat;
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

  const tests = [...agg.entries()]
    .filter(([file]) => isTest(file))
    .map(([file, { perPlat, ...a }]) => ({ file, ...a }));
  const sorted = tests.toSorted((a, b) => b.maxMs - a.maxMs).slice(0, TOP_N);
  // The waits are shard time all the same, so list the longest. A file missing
  // from test/docker/prestart-map.mjs is the actionable kind: once listed, the
  // runner starts its service as the shard starts and schedules the file last.
  // A listed file that still waited ran before its service was up anyway:
  // runner.node.mjs moves the files a PR modifies to the front of the shard,
  // or the shard had too little other work to cover the start-up.
  const prestartPrefixes = Object.keys(prestartMap);
  const waited = tests
    .filter(t => t.maxContainerMs > 0)
    .map(t => {
      const relative = t.file.replace(/^test\//, "");
      return { ...t, prestarted: prestartPrefixes.some(prefix => relative.startsWith(prefix)) };
    })
    .toSorted((a, b) => b.maxContainerMs - a.maxContainerMs);

  console.error(`${agg.size} unique entries, ${sorted.length} test files after filtering`);
  if (waited.length) {
    console.error(`${waited.length} files waited for a container (not counted above); longest waits:`);
    for (const t of waited.slice(0, 5)) {
      const note = t.prestarted ? "" : "\t(not in test/docker/prestart-map.mjs)";
      console.error(`  ${(t.maxContainerMs / 1000).toFixed(1).padStart(6)}s\t${t.file}\t${t.containerPlat}${note}`);
    }
  }
  console.error(`logs cached at ${CACHE}`);

  if (json) {
    console.log(JSON.stringify({ build: BUILD, count: agg.size, top: sorted, containerWaits: waited }, null, 2));
  } else {
    console.log(`rank\tseconds\tfile\tslowest_platform\tmax_container_wait`);
    sorted.forEach((t, i) =>
      console.log(
        `${i + 1}\t${(t.maxMs / 1000).toFixed(2)}\t${t.file}\t${t.maxPlat}\t${(t.maxContainerMs / 1000).toFixed(2)}`,
      ),
    );
  }
  process.exit(0);
}
