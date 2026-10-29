#!/usr/bin/env bun
// Resolve a branch / PR / URL to BuildKite build number(s) for the `bun` pipeline.
//
// Prints build number(s) to stdout (one per line) so it composes with `bk`:
//   bk build view $(bun run ci:find)
//   bk job log <uuid> -b $(bun run ci:find)
//
// With --status / --watch / --errors / --logs, acts on the resolved build directly.
//
// Requires: `bk` (BuildKite CLI) and, for PR-number targets, `gh`.

import { $ } from "bun";
import { parseArgs } from "node:util";

const tty = Bun.enableANSIColors;
const c = {
  reset: tty ? "\x1b[0m" : "",
  bold: tty ? "\x1b[1m" : "",
  dim: tty ? "\x1b[2m" : "",
  red: tty ? "\x1b[31m" : "",
  yellow: tty ? "\x1b[33m" : "",
};

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: bun scripts/find-build.ts [target] [options]

Resolve a BuildKite build number for the bun pipeline.

Target (optional, defaults to current git branch):
  #12345                       GitHub PR number
  https://github.com/.../pull/12345
  https://buildkite.com/bun/bun/builds/43756
  43756                        Build number (passthrough)
  my-branch-name               Branch name

Options:
  -n, --limit <N>      Print the last N builds instead of just the latest
  --branch <name>      Use this branch (same as positional)
  --status             Print a one-screen progress summary for the build
  --watch              Poll and redraw --status every 10s until the build finishes
  --errors             Print rendered test-failure annotations for the build (the first 200)
  --logs               Save full logs for each failed job to ./tmp/ci-<build>/
  --all                With --errors, include warning/info annotations too (flaky is shown without it)
  --no-compare         With --errors, skip the "[pre-existing]" check against recently merged PRs
  --no-dedup           With --errors, print every platform's output in full
  -h, --help           Show this help

For anything else, compose with \`bk\` directly (.bk.yaml sets the pipeline):
  bk build view $(bun run ci:find)
  bk job log <uuid> -b $(bun run ci:find)
  bk api "/pipelines/bun/builds/$(bun run ci:find)/annotations?per_page=100&page=1"
`);
  process.exit(0);
}

const { values: opts, positionals } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    limit: { type: "string", short: "n", default: "1" },
    branch: { type: "string" },
    status: { type: "boolean" },
    watch: { type: "boolean" },
    errors: { type: "boolean" },
    logs: { type: "boolean" },
    all: { type: "boolean" },
    "no-compare": { type: "boolean" },
    "no-dedup": { type: "boolean" },
  },
});

const target = positionals[0] ?? opts.branch;

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (!Bun.which("bk")) {
  die(
    "`bk` (BuildKite CLI) not found.\n" +
      "  Install: brew install buildkite/buildkite/bk\n" +
      "  Auth:    export BUILDKITE_API_TOKEN=<token>  (https://buildkite.com/user/api-access-tokens)",
  );
}

async function bk<T = any>(...argv: string[]): Promise<T> {
  const { exitCode, stdout, stderr } = await $`bk ${argv}`.quiet().nothrow();
  if (exitCode !== 0) throw new Error(`bk ${argv.join(" ")}: ${stderr.toString().trim()}`);
  return JSON.parse(stdout.toString());
}

let buildNumber: number | undefined;
let branch: string | undefined;

if (target == null) {
  branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
} else if (/buildkite\.com\/.+\/builds\/(\d+)/.test(target)) {
  buildNumber = Number(target.match(/builds\/(\d+)/)![1]);
} else if (/github\.com\/.+\/pull\/(\d+)/.test(target) || /^#\d+$/.test(target)) {
  const pr = target.match(/(\d+)/)![1];
  branch = (await $`gh pr view ${pr} --repo oven-sh/bun --json headRefName -q .headRefName`.text()).trim();
  if (!branch) die(`could not resolve PR #${pr} to a branch`);
} else if (/^\d+$/.test(target)) {
  buildNumber = Number(target);
} else {
  branch = target;
}

type Build = { number: number; state: string; web_url: string; commit?: string };
let builds: Build[];

try {
  if (buildNumber != null) {
    builds = [{ number: buildNumber, state: "", web_url: `https://buildkite.com/bun/bun/builds/${buildNumber}` }];
  } else {
    // `bk build view -b <branch>` silently filters by creator; use `list` instead.
    builds = await bk("build", "list", "--branch", branch!, "--limit", opts.limit!, "--json");
    if (builds.length === 0) die(`no builds found for branch '${branch}'`);
  }

  if (opts.status) await printStatus(builds[0].number);
  else if (opts.watch) await watchStatus(builds[0].number);
  else if (opts.logs) await saveLogs(builds[0].number);
  else if (opts.errors)
    await printErrors(builds[0].number, { all: !!opts.all, compare: !opts["no-compare"], excludeBranch: branch });
  else
    for (const b of builds) {
      process.stdout.write(b.number + "\n");
      if (process.stderr.isTTY) {
        console.error(`  ${b.state.padEnd(9)} ${b.commit?.slice(0, 10) ?? ""}  ${b.web_url}`);
      }
    }
} catch (e) {
  die((e as Error).message);
}

// --- annotation rendering --------------------------------------------------

type AnnotationSummary = { style: string; context: string };
type Annotation = AnnotationSummary & { body_html: string };
/** `more`: `list` ends at the limit of the read, and the build is not known to end there. */
type Annotations<T> = { list: T[]; more: boolean };
type Job = { id: string; type: string; name: string; state: string; soft_failed?: boolean; web_url: string };

function isFailedJob(j: Job) {
  return j.type === "script" && ["failed", "broken", "timed_out"].includes(j.state) && !j.soft_failed;
}

// `bk api` returns one page, of at most 100: https://buildkite.com/docs/apis/rest-api#pagination
// A build can have thousands of annotations and 100 bodies can be megabytes, hence `maxPages`.
function annotations(build: number, read: { bodies: true; maxPages?: number }): Promise<Annotations<Annotation>>;
function annotations(
  build: number,
  read: { bodies: false; maxPages?: number },
): Promise<Annotations<AnnotationSummary>>;
async function annotations(build: number, { bodies, maxPages = 2 }: { bodies: boolean; maxPages?: number }) {
  const perPage = 100;
  const endpoint = `/pipelines/bun/builds/${build}/annotations`;
  const list: AnnotationSummary[] = [];
  const ids = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const batch = await bk<(AnnotationSummary & { id: string })[]>(
      "api",
      `${endpoint}?per_page=${perPage}&page=${page}${bodies ? "" : "&omit_body=true"}`,
    );
    // A running build can add an annotation ahead of the ones already read. That moves one of them to the next page.
    for (const annotation of batch) {
      if (ids.has(annotation.id)) continue;
      ids.add(annotation.id);
      list.push(annotation);
    }
    if (batch.length < perPage) return { list, more: false };
  }
  // Only the note that the list is cut depends on this request. If it fails, the note is printed.
  const next = await bk<AnnotationSummary[]>(
    "api",
    `${endpoint}?per_page=1&page=${maxPages * perPage + 1}&omit_body=true`,
  ).catch(() => null);
  return { list, more: next == null || next.length > 0 };
}

function renderTermHTML(html: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
  return (
    html
      // <span class="term-fg31 term-fg1">..</span>  ->  \x1b[31;1m..\x1b[0m
      .replace(/<span class="([^"]+)">/g, (_, cls: string) => {
        if (!tty) return "";
        const codes = [...cls.matchAll(/term-fg(\d+)/g)].map(m => m[1]);
        return codes.length ? `\x1b[${codes.join(";")}m` : "";
      })
      .replace(/<\/span>/g, tty ? "\x1b[0m" : "")
      .replace(/<img class="emoji"[^>]*alt="([^"]+)"[^>]*>/g, "$1")
      .replace(/<\/?(?:a|code|pre|details|summary|p|br|strong|em|b|i)\b[^>]*>/g, "")
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => entities[e])
      .replace(/\r/g, "")
      .replace(/^[^\S\n]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
  );
}

function renderAnnotation(a: Annotation, tag: string) {
  const color = a.style === "error" ? c.red : c.yellow;
  console.log(`\n${color}${c.bold}== ${a.context} ==${c.reset}${tag}`);
  // body_html is a sequence of <details><summary>…</summary><pre>…</pre></details>, one per platform.
  const sections = [...a.body_html.matchAll(/<details><summary>(.*?)<\/summary>(.*?)<\/details>/gs)];
  if (sections.length === 0) {
    console.log(renderTermHTML(a.body_html));
    return;
  }
  const seen = new Set<string>();
  for (const [, summary, body] of sections) {
    const header = renderTermHTML(summary).trim();
    const text = renderTermHTML(body).replace(/^\s*\n+|\n\s*$/g, "");
    const key = normalizeForDedup(text);
    if (!opts["no-dedup"] && seen.has(key)) {
      console.log(`${c.dim}   ${header}  (same as above)${c.reset}`);
    } else {
      seen.add(key);
      console.log(`${c.dim}-- ${header}${c.reset}`);
      console.log(text);
    }
  }
}

// The `context=flaky style=warning` annotation bundles every retried test into one block,
// unlike error annotations which are one-per-test. Split it back out so each flaky test
// renders the same way an error does (own `== path ==` heading, per-platform dedup).
function splitFlaky(a: Annotation): Annotation[] {
  const byTest = new Map<string, string>();
  for (const [block, summary] of a.body_html.matchAll(/<details><summary>(.*?)<\/summary>.*?<\/details>/gs)) {
    const test = summary.match(/<code>(.*?)<\/code>/)?.[1] ?? renderTermHTML(summary).split(" - ")[0].trim();
    byTest.set(test, (byTest.get(test) ?? "") + block);
  }
  return [...byTest].map(([context, body_html]) => ({ context, style: "flaky", body_html }));
}

function normalizeForDedup(s: string): string {
  return Bun.stripANSI(s)
    .replace(/[\d.]+m?s\b/g, "<t>")
    .replace(/([A-Z]:)?[\\/][\w\\/.:+-]*?[\\/](test[\\/])/g, "$2")
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ");
}

async function printErrors(
  build: number,
  { all, compare, excludeBranch }: { all: boolean; compare: boolean; excludeBranch: string | null | undefined },
) {
  console.log(`${c.bold}build #${build}${c.reset}  https://buildkite.com/bun/bun/builds/${build}\n`);

  const [{ list: anns, more }, baseline] = await Promise.all([
    annotations(build, { bodies: true }),
    compare ? mergedPRFailingContexts(excludeBranch) : Promise.resolve(null),
  ]);
  // Printed above the annotations and below them: megabytes of output can lie between.
  const cut = more && `${c.yellow}(only the first ${anns.length} annotations of this build are read)${c.reset}`;
  if (cut) console.log(cut);

  // "flaky-new": the same, of a file that test/flaky-tests.txt does not list.
  const isFlaky = (a: Annotation) => a.context === "flaky" || a.context === "flaky-new";
  const flaky = anns.filter(isFlaky).flatMap(splitFlaky);
  const rest = anns.filter(a => !isFlaky(a));
  const shown = rest.filter(a => all || a.style === "error");

  if (shown.length === 0 && flaky.length === 0) {
    const other = rest.length;
    const scope = more ? ` in the first ${anns.length}` : "";
    console.log(`no error annotations${scope}${other ? ` (${other} warning/info; pass --all to show)` : ""}`);
    return;
  }

  const tag = (a: Annotation) =>
    a.style !== "error"
      ? ""
      : baseline == null
        ? ""
        : baseline.has(a.context)
          ? ` ${c.dim}[pre-existing]${c.reset}`
          : ` ${c.yellow}[new]${c.reset}`;

  // New-on-this-branch first.
  shown.sort((a, b) => Number(baseline?.has(a.context) ?? 0) - Number(baseline?.has(b.context) ?? 0));
  for (const a of shown) renderAnnotation(a, tag(a));
  for (const a of flaky) renderAnnotation(a, ` ${c.yellow}[flaky]${c.reset}`);

  if (cut) console.log(`\n${cut}`);
  if (baseline == null && compare) {
    console.log(`\n${c.dim}(no comparison: could not read the builds of recently merged PRs)${c.reset}`);
  }
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "-";
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${m}m` : m ? `${m}m` : `${s}s`;
}

async function fetchStatus(build: number) {
  type Full = { state: string; started_at: string | null; finished_at: string | null; web_url: string; jobs: Job[] };
  let unread: string | undefined;
  const [b, anns] = await Promise.all([
    bk<Full>("build", "view", String(build), "--json"),
    annotations(build, { bodies: false }).catch((e: Error) => {
      unread = e.message;
      return { list: [], more: false };
    }),
  ]);

  const out: string[] = [];
  const jobs = b.jobs.filter(j => j.type === "script");
  const counts: Record<string, number> = {};
  for (const j of jobs) counts[j.state] = (counts[j.state] ?? 0) + 1;
  const failed = jobs.filter(isFailedJob);

  const stateColor = b.state === "passed" ? "\x1b[32m" : b.state === "failed" ? c.red : c.yellow;
  out.push(`${c.bold}#${build}${c.reset} ${tty ? stateColor : ""}${b.state}${c.reset}  ${b.web_url}`);
  out.push(
    `${c.dim}started ${ago(b.started_at)} ago` +
      (b.finished_at ? `, finished ${ago(b.finished_at)} ago` : "") +
      c.reset,
  );

  const order = ["passed", "failed", "broken", "timed_out", "running", "scheduled", "waiting"];
  const parts = [...new Set([...order, ...Object.keys(counts)])].filter(s => counts[s]).map(s => `${counts[s]} ${s}`);
  out.push("", `${c.bold}jobs:${c.reset} ${parts.join(", ")}  ${c.dim}(${jobs.length} total)${c.reset}`);

  if (failed.length) {
    out.push("", `${c.red}${c.bold}failed jobs:${c.reset}`);
    for (const j of failed) out.push(`  ${j.name.padEnd(48)} ${c.dim}${j.web_url}${c.reset}`);
  }

  const err = anns.list.filter(a => a.style === "error");
  const other = anns.list.length - err.length;
  const maxNames = 30;
  if (err.length) {
    out.push("", `${c.red}${c.bold}failing tests so far:${c.reset}`);
    for (const a of err.slice(0, maxNames)) out.push(`  ${a.context}`);
  }
  if (err.length > maxNames) {
    out.push(`${c.dim}  (+${err.length - maxNames} more: bun run ci:errors ${build})${c.reset}`);
  }
  if (other) out.push(`${c.dim}  (+${other} warning/flaky)${c.reset}`);
  if (anns.more) out.push(`${c.dim}  (only the first ${anns.list.length} annotations are counted)${c.reset}`);
  if (unread) out.push("", `${c.dim}(could not read the annotations: ${unread})${c.reset}`);

  if (!failed.length && !err.length && !anns.more && !unread && b.finished_at) {
    out.push("", `${c.dim}no failures${c.reset}`);
  }
  return { state: b.state, lines: out };
}

async function printStatus(build: number) {
  const { lines } = await fetchStatus(build);
  console.log(lines.join("\n"));
}

async function watchStatus(build: number) {
  const terminal = new Set(["passed", "failed", "canceled", "blocked", "skipped", "not_run"]);
  const isTTY = process.stdout.isTTY;
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let prevLines = 0;
  for (;;) {
    const { state, lines } = await fetchStatus(build);
    if (isTTY && prevLines > 0) process.stdout.write(`\r\x1b[${prevLines}A\x1b[J`);
    process.stdout.write(lines.join("\n") + "\n");
    if (terminal.has(state)) process.exit(state === "passed" ? 0 : 1);
    if (!isTTY) {
      console.log();
      await Bun.sleep(10_000);
      continue;
    }
    prevLines = lines.length + 1;
    for (let i = 0; i < 100; i++) {
      const left = 10 - Math.floor(i / 10);
      process.stdout.write(
        `\r${c.dim}${frames[i % frames.length]} watching — next refresh in ${left}s (^C to stop)${c.reset}  `,
      );
      await Bun.sleep(100);
    }
    process.stdout.write(`\r${c.dim}${frames[0]} fetching…${c.reset}\x1b[K`);
  }
}

async function saveLogs(build: number) {
  const b = await bk<{ jobs: Job[] }>("build", "view", String(build), "--json");
  const failed = b.jobs.filter(isFailedJob);
  if (failed.length === 0) return console.log(`no failed jobs in build #${build}`);

  const dir = `tmp/ci-${build}`;
  await $`mkdir -p ${dir}`.quiet();
  console.log(`saving ${failed.length} log(s) to ${dir}/`);

  // Multiple failed jobs can share a display name (sharded test-bun lanes);
  // suffix duplicates with the job-id tail so later shards don't overwrite
  // earlier ones.
  const seen = new Map<string, number>();
  await Promise.all(
    failed.map(async j => {
      let name = j.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      if (n > 1) name += `-${j.id.slice(-8)}`;
      const path = `${dir}/${name}.log`;
      const { exitCode, stdout, stderr } = await $`bk job log ${j.id} -b ${String(build)}`.quiet().nothrow();
      if (exitCode !== 0) return console.error(`  ${j.name}: ${stderr.toString().trim()}`);
      // Strip BuildKite APC timestamp markers first; an unterminated \x1b_ makes Bun.stripANSI eat to EOF.
      const text = stdout
        .toString()
        // oxlint-disable-next-line no-control-regex -- BuildKite APC timestamp marker is ESC_…BEL
        .replace(/\u001b_(?:bk;t=\d+\u0007)?/g, "")
        .replace(/\r/g, "");
      await Bun.write(path, Bun.stripANSI(text));
      console.log(`  ${path}`);
    }),
  );
}

async function mergedPRFailingContexts(excludeBranch: string | null | undefined): Promise<Set<string> | null> {
  // main builds don't run tests (build-only), so compare against the last few
  // merged PRs' final builds — anything still failing there is pre-existing.
  // A request that fails ends the comparison: a build left out would turn its failures into `[new]`.
  try {
    const merged: Array<{ headRefName: string }> =
      await $`gh pr list --repo oven-sh/bun --state merged --limit 5 --json headRefName`.json();
    const branches = merged.map(p => p.headRefName).filter(b => b && b !== excludeBranch);
    if (branches.length === 0) return null;
    const builds = await Promise.all(
      branches.map(b =>
        bk("build", "list", "--branch", b, "--state", "finished", "--limit", "1", "--json").then(
          (r: Build[]) => r[0]?.number,
        ),
      ),
    );
    const results = await Promise.all(
      builds.filter((n): n is number => n != null).map(n => annotations(n, { bodies: false, maxPages: Infinity })),
    );
    return new Set(
      results
        .flatMap(r => r.list)
        .filter(a => a.style === "error")
        .map(a => a.context),
    );
  } catch {
    return null;
  }
}
