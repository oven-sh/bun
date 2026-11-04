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
  --no-compare         With --errors, skip the comparison with main
  --no-dedup           With --errors, print every platform's output in full
  -h, --help           Show this help

--errors compares each failing test file with passed or failed builds of main:
  [pre-existing]       it also fails in one of the two builds of main before this build
  [on newer main #N]   it does not, but it fails in build N, the first build of main after this build
  [new]                it fails in none of them
  [flaky]              it passed on a retry. It is not compared.
A build of main is compared only with the builds of main before it.

--errors, --status and --watch count a failure only for the latest attempt of a job. When Buildkite ran a
job again, what the attempt that it replaced reported is left out, and a line says how much:
  [replaced attempt]   only such an attempt reported on the file. It is not compared.
[flaky] files stay. The builds of main in the comparison count every attempt.

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

/**
 * A target given as a build number has no `branch`, no `created_at` and no `jobs`: nothing is asked about it
 * up front. `jobs`: every attempt of each job, when `--errors` asked for the build of a branch.
 */
type Build = {
  number: number;
  state: string;
  web_url: string;
  commit?: string;
  branch?: string;
  created_at?: string;
  jobs?: Job[];
};
let builds: Build[];

try {
  const errors = opts.errors && !opts.status && !opts.watch && !opts.logs;
  if (buildNumber != null) {
    builds = [{ number: buildNumber, state: "", web_url: `https://buildkite.com/bun/bun/builds/${buildNumber}` }];
  } else if (errors) {
    // One build, with every attempt of its jobs. For `--limit 1`, `bk build list` reads a page of 100 builds.
    const newest = `branch=${encodeURIComponent(branch!)}&per_page=1&include_retried_jobs=true`;
    builds = await bk("api", `/pipelines/bun/builds?${newest}`);
  } else {
    // `bk build view -b <branch>` silently filters by creator; use `list` instead.
    builds = await bk("build", "list", "--branch", branch!, "--limit", opts.limit!, "--json");
  }
  if (builds.length === 0) die(`no builds found for branch '${branch}'`);

  if (opts.status) await printStatus(builds[0].number);
  else if (opts.watch) await watchStatus(builds[0].number);
  else if (opts.logs) await saveLogs(builds[0].number);
  else if (errors) await printErrors(builds[0], { all: !!opts.all, compare: !opts["no-compare"] });
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
/**
 * `more`: the build can have an annotation that `list` does not hold. The read ended at its limit, or the build
 * got an annotation while it was read.
 */
type Pages<T> = { list: T[]; more: boolean };
type Job = {
  id: string;
  type: string;
  name: string;
  state: string;
  soft_failed?: boolean;
  web_url: string;
  command?: string | null;
  exit_status?: number | null;
  started_at?: string | null;
  /** Buildkite ran the job again: the job `retried_in_job_id` replaced this attempt. */
  retried?: boolean;
  retried_in_job_id?: string | null;
};
/** A build as the REST API gives it when it is asked for every attempt of each job. */
type EveryAttempt = Build & { started_at: string | null; finished_at: string | null; jobs: Job[] };
/**
 * How `annotations` gets every attempt of the jobs of the build. `request`: `jobs()` makes a request that
 * nothing else needs, so it is not called when no section names a job.
 */
type Attempts = { jobs: () => Promise<Job[]>; request: boolean };
/** A job attempt that Buildkite replaced after it started, and the latest attempt of its job. */
type Replaced = { attempt: Job; latest: Job | undefined };
type LeftOut = {
  sections: number;
  /** The replaced attempts that wrote those sections. */
  attempts: Map<string, Replaced>;
  /** The annotations that only replaced attempts wrote to. */
  annotations: AnnotationSummary[];
  /** Why nothing is left out. */
  unchecked?: string;
};
/** `read`: how many annotations the pages held. `list` holds fewer of them when some are left out. */
type Annotations<T> = Pages<T> & { read: number; leftOut: LeftOut };

function isFailedJob(j: Job) {
  return j.type === "script" && ["failed", "broken", "timed_out"].includes(j.state) && !j.soft_failed;
}

// "flaky-new": the same, of a file that test/flaky-tests.txt does not list.
function isFlaky(a: AnnotationSummary) {
  return a.context === "flaky" || a.context === "flaky-new";
}

// The job list of a build holds the latest attempt of each job, unless it is asked for the others too.
function everyAttempt(build: number) {
  return bk<EveryAttempt>("api", `/pipelines/bun/builds/${build}?include_retried_jobs=true`);
}

// `bk api` returns one page, of at most 100: https://buildkite.com/docs/apis/rest-api#pagination
// A build can have thousands of annotations and 100 bodies can be megabytes, hence `maxPages`.
async function annotationPages(
  build: number,
  bodies: boolean,
  maxPages: number,
): Promise<Pages<AnnotationSummary & { body_html?: string }>> {
  const perPage = 100;
  const endpoint = `/pipelines/bun/builds/${build}/annotations`;
  const list: AnnotationSummary[] = [];
  const ids = new Set<string>();
  // A running build can add an annotation ahead of the ones already read. That moves one of them to the next
  // page, where it shows again. The new annotation is on a page that was read before, so this read misses it.
  let moved = false;
  for (let page = 1; page <= maxPages; page++) {
    const batch = await bk<(AnnotationSummary & { id: string })[]>(
      "api",
      `${endpoint}?per_page=${perPage}&page=${page}${bodies ? "" : "&omit_body=true"}`,
    );
    for (const annotation of batch) {
      if (ids.has(annotation.id)) {
        moved = true;
        continue;
      }
      ids.add(annotation.id);
      list.push(annotation);
    }
    if (batch.length < perPage) return { list, more: moved };
  }
  // Only the note that the list is cut depends on this request. If it fails, the note is printed.
  const next = await bk<AnnotationSummary[]>(
    "api",
    `${endpoint}?per_page=1&page=${maxPages * perPage + 1}&omit_body=true`,
  ).catch(() => null);
  return { list, more: moved || next == null || next.length > 0 };
}

// body_html is a sequence of <details><summary>…</summary><pre>…</pre></details>: one section for each time a
// job reported on the context. The summary links that job: getBuildUrl() in scripts/buildkite.ts. It also links
// the test file, and that link can end in `#L<line>`, so only a link to a build names a job.
// `job`: the id of the job, or an empty string when the section names none.
function sectionsOf(bodyHtml: string) {
  const jobLink = /href="https:\/\/buildkite\.com\/[^"#]+\/builds\/\d+#([0-9a-f-]{36})"/;
  const sections = bodyHtml.matchAll(/<details><summary>(.*?)<\/summary>(.*?)<\/details>/gs);
  return Array.from(sections, ([html, summary = "", body = ""]) => ({
    html,
    summary,
    body,
    job: summary.match(jobLink)?.[1] ?? "",
  }));
}

// An attempt that did not start wrote nothing. A section that names it is the note of another writer, on a job
// that got no agent, and it stays.
function replacedAttempts(jobs: Job[]) {
  const byId = new Map(jobs.map(job => [job.id, job]));
  const replaced = new Map<string, Replaced>();
  for (const attempt of jobs) {
    if (!attempt.retried || attempt.started_at == null) continue;
    // `seen`: a chain that comes back to an attempt has no latest attempt.
    const seen = new Set<string>();
    let latest: Job | undefined = attempt;
    while (latest?.retried) {
      seen.add(latest.id);
      const next: string = latest.retried_in_job_id ?? "";
      latest = seen.has(next) ? undefined : byId.get(next);
    }
    replaced.set(attempt.id, { attempt, latest });
  }
  return replaced;
}

// An annotation is a log. A job attempt appends a section when a test file fails in it, and the section stays
// when Buildkite replaces the attempt (an automatic retry after the agent is lost, or a manual one). Buildkite
// counts only the latest attempt of a job, for the state of the build and in its job list. So this leaves out
// each section of a replaced attempt and each annotation that holds nothing else, and says so in `leftOut`.
// When a request fails, everything stays and `leftOut.unchecked` says why.
// `attempts: "counted"`: nothing is left out.
type Read = { maxPages?: number; attempts?: Attempts | "counted" };
function annotations(build: number, read: Read & { bodies: true }): Promise<Annotations<Annotation>>;
function annotations(build: number, read: Read & { bodies: false }): Promise<Annotations<AnnotationSummary>>;
async function annotations(
  build: number,
  {
    bodies,
    maxPages = 2,
    attempts = { jobs: () => everyAttempt(build).then(b => b.jobs), request: true },
  }: Read & { bodies: boolean },
) {
  let { list, more } = await annotationPages(build, bodies, maxPages);
  const leftOut: LeftOut = { sections: 0, attempts: new Map(), annotations: [] };
  const uncut = () => ({ list, more, read: list.length, leftOut });
  if (attempts === "counted") return uncut();
  const unchecked = (e: Error) => {
    leftOut.unchecked = e.message;
    return null;
  };

  const parse = () => list.map(annotation => ({ annotation, sections: sectionsOf(annotation.body_html ?? "") }));
  let parsed = parse();
  // With bodies and no job in any section, there is nothing to leave out: no request for the attempts, and no
  // note when they are not known.
  const nothingNamed = bodies && !parsed.some(({ sections }) => sections.some(section => section.job));
  if (nothingNamed && attempts.request) return uncut();
  const jobs = await attempts.jobs().catch(nothingNamed ? () => null : unchecked);
  const replaced = replacedAttempts(jobs ?? []);
  if (replaced.size === 0) return uncut();
  if (!bodies) {
    // Without bodies nothing names a job.
    const withBodies = await annotationPages(build, true, maxPages).catch(unchecked);
    if (!withBodies) return uncut();
    ({ list, more } = withBodies);
    parsed = parse();
  }
  // Every writer of a failure links its job. When no failure has a link, the link has a form that
  // `sectionsOf` does not know, and nothing can be left out.
  const failures = parsed.flatMap(({ annotation, sections }) => (annotation.style === "error" ? sections : []));
  if (failures.length > 0 && failures.every(section => !section.job)) {
    leftOut.unchecked = "no section of a failure links its job";
    return uncut();
  }

  const live: typeof list = [];
  for (const { annotation, sections } of parsed) {
    // `[flaky]` lists a test file that failed and then passed in one job. A replaced attempt saw that too.
    const gone = isFlaky(annotation) ? [] : sections.filter(section => replaced.has(section.job));
    leftOut.sections += gone.length;
    for (const { job } of gone) {
      const attempt = replaced.get(job);
      if (attempt) leftOut.attempts.set(job, attempt);
    }
    if (gone.length === 0) live.push(annotation);
    else if (gone.length === sections.length) leftOut.annotations.push(annotation);
    else {
      const stay = sections.filter(section => !gone.includes(section));
      live.push({ ...annotation, body_html: stay.map(section => section.html).join("\n") });
    }
  }
  return { list: live, more, read: list.length, leftOut };
}

// The test runner exits with 0 or 2 when it ended by itself (getExitCode in scripts/runner.node.ts). Any other
// job ended by itself when it passed or failed and kept its agent: exit -1 is an agent that was lost.
function endedByItself(job: Job) {
  if (job.command?.includes("runner.node.")) return job.exit_status === 0 || job.exit_status === 2;
  return (job.state === "passed" || job.state === "failed") && job.exit_status !== -1;
}

// Not "retry": `[flaky]` uses that word for a test file that passed when the runner ran it again in the same job.
function leftOutNotes(leftOut: LeftOut): string[] {
  if (leftOut.unchecked) return [`(replaced job attempts are not left out: ${leftOut.unchecked})`];
  if (leftOut.sections === 0) return [];
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
  const { sections, attempts } = leftOut;
  const notes = [`(${count(sections, "section")} of ${count(attempts.size, "replaced job attempt")} left out)`];
  // After a latest attempt that did not end by itself, what it replaced can be the only report on a test file.
  const unfinished = new Map<string, { name: string; latest: Job | undefined; replaced: string[] }>();
  for (const { attempt, latest } of attempts.values()) {
    if (latest && endedByItself(latest)) continue;
    const id = latest?.id ?? attempt.id;
    const job = unfinished.get(id) ?? { name: attempt.name, latest, replaced: [] };
    job.replaced.push(attempt.web_url);
    unfinished.set(id, job);
  }
  for (const { name, latest, replaced } of unfinished.values()) {
    const exit = latest?.exit_status == null ? "" : `, exit ${latest.exit_status}`;
    const now = latest ? `(${latest.state}${exit}) ${latest.web_url}` : "(not in the list of jobs)";
    notes.push(`  The latest attempt did not finish: ${name} ${now}, replaced ${replaced.join(" ")}`);
  }
  return notes;
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
  const sections = sectionsOf(a.body_html);
  if (sections.length === 0) {
    console.log(renderTermHTML(a.body_html));
    return;
  }
  const seen = new Set<string>();
  for (const { summary, body } of sections) {
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
  for (const { html, summary } of sectionsOf(a.body_html)) {
    const test = summary.match(/<code>(.*?)<\/code>/)?.[1] ?? renderTermHTML(summary).split(" - ")[0].trim();
    byTest.set(test, (byTest.get(test) ?? "") + html);
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

async function printErrors(target: Build, { all, compare }: { all: boolean; compare: boolean }) {
  const build = target.number;
  console.log(`${c.bold}build #${build}${c.reset}  https://buildkite.com/bun/bun/builds/${build}\n`);

  // A target given as a number: the comparison asks for its branch and the annotations for its job attempts.
  // One request answers both. Without the comparison, only the annotations ask.
  let asked: Promise<EveryAttempt> | undefined;
  const withEveryAttempt = () => (asked ??= everyAttempt(build));
  const { jobs } = target;
  const attempts: Attempts = jobs
    ? { jobs: async () => jobs, request: false }
    : { jobs: () => withEveryAttempt().then(b => b.jobs), request: !compare };

  // The comparison only adds tags. When it fails, the list is printed without them.
  let notCompared = "";
  const [{ list: anns, more, read, leftOut }, main] = await Promise.all([
    annotations(build, { bodies: true, attempts }),
    compare
      ? mainBaseline(target, withEveryAttempt).catch((e: Error) => {
          notCompared = `${c.yellow}not compared with main: ${e.message}${c.reset}`;
          return null;
        })
      : null,
  ]);
  if (main) {
    const failing = (n: number) => `#${n} (${main.errors.get(n)} failing)`;
    const newer = main.newer == null ? [] : [`newer ${failing(main.newer)}`];
    console.log(`${c.dim}compared with main ${[...main.below.map(failing), ...newer].join(", ")}${c.reset}`);
  }
  // These three are printed above the annotations and below them: megabytes of output can lie between.
  if (notCompared) console.log(notCompared);
  const cut = more && `${c.yellow}(only the first ${read} annotations of this build are read)${c.reset}`;
  if (cut) console.log(cut);
  const left = leftOutNotes(leftOut).map(note => `${c.yellow}${note}${c.reset}`);
  for (const note of left) console.log(note);

  const flaky = anns.filter(isFlaky).flatMap(splitFlaky);
  const rest = anns.filter(a => !isFlaky(a));
  const shown = rest.filter(a => all || a.style === "error");
  const replacedOnly = leftOut.annotations.filter(a => all || a.style === "error");

  if (shown.length === 0 && flaky.length === 0) {
    const other = rest.length;
    const scope = more ? ` in the first ${read}` : "";
    console.log(`no error annotations${scope}${other ? ` (${other} warning/info; pass --all to show)` : ""}`);
    if (replacedOnly.length === 0) return;
  }

  const compared = (a: Annotation): { order: number; tag: string } => {
    if (a.style !== "error" || !main) return { order: 0, tag: "" };
    const on = main.failing.get(a.context);
    if (!on) return { order: 0, tag: ` ${c.yellow}[new]${c.reset}` };
    // Not `[pre-existing]`: this branch can be what brought the failure to main.
    if (on.every(n => n === main.newer)) return { order: 1, tag: ` [on newer main #${main.newer}]` };
    return { order: 2, tag: ` ${c.dim}[pre-existing]${c.reset}` };
  };

  // New-on-this-branch first, then what only the newer build of main has.
  shown.sort((a, b) => compared(a).order - compared(b).order);
  for (const a of shown) renderAnnotation(a, compared(a).tag);
  for (const a of flaky) renderAnnotation(a, ` ${c.yellow}[flaky]${c.reset}`);
  if (replacedOnly.length) console.log();
  for (const a of replacedOnly) console.log(`${c.dim}== ${a.context} == [replaced attempt]${c.reset}`);

  if (cut) console.log(`\n${cut}`);
  if (left.length) console.log(`\n${left.join("\n")}`);
  if (notCompared) console.log(`\n${notCompared}`);
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "-";
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${m}m` : m ? `${m}m` : `${s}s`;
}

async function fetchStatus(build: number) {
  let unread: string | undefined;
  // Not `bk build view`: it lists only the latest attempt of each job, and it reads 30 annotation bodies too.
  const asked = everyAttempt(build);
  const [b, anns] = await Promise.all([
    asked,
    annotations(build, { bodies: false, attempts: { jobs: () => asked.then(b => b.jobs), request: false } }).catch(
      (e: Error): Annotations<AnnotationSummary> => {
        unread = e.message;
        return { list: [], more: false, read: 0, leftOut: { sections: 0, attempts: new Map(), annotations: [] } };
      },
    ),
  ]);

  const out: string[] = [];
  const jobs = b.jobs.filter(j => j.type === "script" && !j.retried);
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
  if (anns.more) out.push(`${c.dim}  (only the first ${anns.read} annotations are counted)${c.reset}`);
  for (const note of leftOutNotes(anns.leftOut)) out.push(`${c.dim}  ${note}${c.reset}`);
  if (unread) out.push("", `${c.dim}(could not read the annotations: ${unread})${c.reset}`);

  // A canceled or blocked build has ended too, and it can have no failed job.
  if (b.state === "passed" && !failed.length && !err.length && !anns.more && !unread) {
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

/** `errors`: build of main -> its count of error annotations. `failing`: context -> the builds of main that have it. */
type Baseline = { below: number[]; newer?: number; errors: Map<number, number>; failing: Map<string, number[]> };

// The builds of main that a build is compared with, every page of each.
//   `below`: the two newest that are numbered below the target. A lower number is an earlier build, so main
//            had their failures before the target existed.
//   `newer`: the first one that is numbered above the target. A commit of main that the target holds can
//            have its first complete build there, and so can an outage that hit both. But the target's
//            branch can also be what brought a failure there. A target on main gets none: that build has
//            what the target brought.
// Only a passed or failed build counts, because a canceled build holds a part of its annotations. Of those,
// only a build that ran its tests: see `ranTests`.
// Throws when a request fails, because a build that is left out would turn its failures into `[new]`.
// `withEveryAttempt`: asks for the target, for the branch of one that is given as a number.
async function mainBaseline(target: Build, withEveryAttempt: () => Promise<Build>): Promise<Baseline> {
  type MainBuild = { number: number; meta_data?: Record<string, string> };
  const perPage = 10;
  const complete = `/pipelines/bun/builds?branch=main&state[]=passed&state[]=failed&exclude_jobs=true&exclude_pipeline=true&per_page=${perPage}`;
  // A test job sets a `reported-<job>` key when its runner ends: markBuildkiteStepReported() in
  // scripts/buildkite.ts. A build that stops at a compile error ends as failed, with the few keys of its failed
  // build steps and no test result. So a build counts when at least half as many jobs reported as in the best
  // build of the list.
  const reported = (b: MainBuild) => Object.keys(b.meta_data ?? {}).filter(key => key.startsWith("reported-")).length;
  const ranTests = (list: MainBuild[]) => {
    const most = Math.max(1, ...list.map(reported));
    return list.filter(b => reported(b) * 2 >= most);
  };

  const [page, { branch, created_at }] = await Promise.all([
    bk<MainBuild[]>("api", complete),
    target.created_at ? target : withEveryAttempt(),
  ]);
  const newest = ranTests(page);
  // Newest first. Which build is the first above the target is known only when the page reaches below the target.
  const reaches = page.some(b => b.number < target.number);
  const newer = branch === "main" || !reaches ? undefined : newest.findLast(b => b.number > target.number)?.number;
  let before = newest.filter(b => b.number < target.number);
  // The builds to compare with are past the end of the page: an older target, or builds that ran no tests.
  // `created_to` is exclusive.
  if (before.length < 2 && page.length === perPage) {
    before = ranTests(await bk<MainBuild[]>("api", `${complete}&created_to=${created_at}`));
  }
  const below = before.slice(0, 2).map(b => b.number);
  if (below.length === 0) throw new Error("no passed or failed build of main ran its tests before this build");
  const numbers = newer == null ? below : [...below, newer];

  // Every attempt of a build of main counts. A test file that failed in an attempt there can fail without the
  // target's branch, and that is what `[pre-existing]` says, also when the job passed once it ran again.
  const lists = await Promise.all(
    numbers.map(n => annotations(n, { bodies: false, maxPages: Infinity, attempts: "counted" })),
  );
  const errors = new Map<number, number>();
  const failing = new Map<string, number[]>();
  for (const [i, { list }] of lists.entries()) {
    const contexts = list.filter(a => a.style === "error").map(a => a.context);
    errors.set(numbers[i], contexts.length);
    for (const context of contexts) failing.set(context, [...(failing.get(context) ?? []), numbers[i]]);
  }
  return { below, newer, errors, failing };
}
