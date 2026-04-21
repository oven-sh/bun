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
  --errors             Print rendered test-failure annotations for the build
  --logs               Save full logs for each failed job to ./tmp/ci-<build>/
  --all                With --errors, include warning/flaky annotations too
  --no-compare         With --errors, skip the "[pre-existing]" check against recently merged PRs
  --no-dedup           With --errors, print every platform's output in full
  -h, --help           Show this help

For anything else, compose with \`bk\` directly (.bk.yaml sets the pipeline):
  bk build view $(bun run ci:find)
  bk job log <uuid> -b $(bun run ci:find)
  bk api /pipelines/bun/builds/$(bun run ci:find)/annotations
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

type Annotation = { style: string; context: string; body_html: string };
type Job = { id: string; type: string; name: string; state: string; soft_failed?: boolean; web_url: string };

function isFailedJob(j: Job) {
  return j.type === "script" && ["failed", "broken", "timed_out"].includes(j.state) && !j.soft_failed;
}

async function annotations(build: number): Promise<Annotation[]> {
  return bk("api", `/pipelines/bun/builds/${build}/annotations`);
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

function renderAnnotation(a: Annotation, preExisting: boolean | null) {
  const color = a.style === "error" ? c.red : c.yellow;
  const tag =
    preExisting == null ? "" : preExisting ? ` ${c.dim}[pre-existing]${c.reset}` : ` ${c.yellow}[new]${c.reset}`;
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

  const [anns, baseline] = await Promise.all([
    annotations(build),
    compare ? mergedPRFailingContexts(excludeBranch) : Promise.resolve(null),
  ]);

  const shown = anns.filter(a => all || a.style === "error");
  if (shown.length === 0) {
    const other = anns.length - shown.length;
    console.log(`no error annotations${other ? ` (${other} warning/flaky; pass --all to show)` : ""}`);
    return;
  }

  // New-on-this-branch first.
  shown.sort((a, b) => Number(baseline?.has(a.context) ?? 0) - Number(baseline?.has(b.context) ?? 0));
  for (const a of shown) renderAnnotation(a, baseline == null ? null : baseline.has(a.context));

  if (baseline == null && compare) {
    console.log(`\n${c.dim}(could not fetch recently merged PRs for comparison)${c.reset}`);
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
  const [b, anns] = await Promise.all([
    bk<Full>("build", "view", String(build), "--json"),
    annotations(build).catch(() => [] as Annotation[]),
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

  const err = anns.filter(a => a.style === "error");
  const other = anns.length - err.length;
  if (err.length) {
    out.push("", `${c.red}${c.bold}failing tests so far:${c.reset}`);
    for (const a of err) out.push(`  ${a.context}`);
  }
  if (other) out.push(`${c.dim}  (+${other} warning/flaky)${c.reset}`);

  if (!failed.length && !err.length && b.finished_at) {
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

  await Promise.all(
    failed.map(async j => {
      const name = j.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
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
  let merged: Array<{ headRefName: string }>;
  try {
    merged = await $`gh pr list --repo oven-sh/bun --state merged --limit 5 --json headRefName`.json();
  } catch {
    return null;
  }
  const branches = merged.map(p => p.headRefName).filter(b => b && b !== excludeBranch);
  if (branches.length === 0) return null;
  const builds = await Promise.all(
    branches.map(b =>
      bk("build", "list", "--branch", b, "--state", "finished", "--limit", "1", "--json").then(
        (r: Build[]) => r[0]?.number,
        () => undefined,
      ),
    ),
  );
  const results = await Promise.all(
    builds.filter((n): n is number => n != null).map(n => annotations(n).catch(() => [] as Annotation[])),
  );
  return new Set(
    results
      .flat()
      .filter(a => a.style === "error")
      .map(a => a.context),
  );
}
