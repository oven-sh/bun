#!/usr/bin/env bun
// Fetch ALL feedback on a PR in one pass: issue comments, review summaries,
// review approvals/change-requests, line-level review comments, and inline
// suggestions. `gh pr view --comments` only returns the issue-stream comments,
// which silently hides everything a reviewer leaves on the Files changed tab.
//
// Usage:
//   bun run pr:comments                    # current branch's PR
//   bun run pr:comments 28838              # by PR number
//   bun run pr:comments '#28838'           # also works
//   bun run pr:comments https://github.com/oven-sh/bun/pull/28838
//   bun run pr:comments 28838 --json       # machine-readable output for jq pipelines
//
// JSON mode emits one object per entry — no header, no legend — with fields:
//   { when, user, kind, location?, body, url?, resolved?, outdated? }
// resolved/outdated come from GitHub's GraphQL reviewThreads and are only
// present on line comments and replies (null for issue comments and review
// verdicts, which have no thread state). You can filter with jq, e.g.
// (the PR is optional, defaults to current branch):
//   bun run pr:comments --json | jq '.[] | select(.user == "Jarred-Sumner")'
//   bun run pr:comments --json | jq '[.[] | select(.resolved == false)]'

import { $ } from "bun";

type Json = Record<string, any>;

// `--paginate` is load-bearing: GitHub's REST API defaults to 30 items per
// page, and without it a PR with more than 30 issue comments / reviews /
// line comments would silently truncate — the exact footgun this script is
// supposed to eliminate. gh follows Link: rel=next headers for us and emits
// one concatenated array.
async function gh(path: string): Promise<Json[]> {
  const result = await $`gh api --paginate ${path}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    console.error(`gh api --paginate ${path} failed (exit ${result.exitCode}).`);
    if (stderr) console.error(stderr);
    console.error("Check that `gh auth status` is healthy and that the PR exists.");
    process.exit(1);
  }
  try {
    return JSON.parse(result.stdout.toString());
  } catch (err) {
    console.error(`Could not parse response from \`gh api --paginate ${path}\` as JSON: ${(err as Error).message}`);
    process.exit(1);
  }
}

// Thread state (isResolved, isOutdated) is only exposed via GraphQL — the REST
// /pulls/N/comments endpoint omits it entirely. Returns a Map from the REST
// comment id (GraphQL `databaseId`) to its thread's state. On any failure we
// warn to stderr and return null so the caller proceeds without annotations
// rather than crashing.
//
// Pagination is fully manual (not `gh api graphql --paginate`) because the
// concatenated output format of gh's --paginate for GraphQL responses is not
// standard JSON. Manual cursor loops let us parse each page with plain
// JSON.parse and also handle nested pagination (per-thread comments) when a
// single thread has more than 100 comments.
type ThreadState = { resolved: boolean; outdated: boolean };

async function runGraphQL(query: string, vars: Record<string, string | number>): Promise<Json | null> {
  const flags = Object.entries(vars).flatMap(([k, v]) => ["-F", `${k}=${v}`]);
  const result = await $`gh api graphql -f query=${query} ${flags}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    console.error(`Warning: gh api graphql failed (exit ${result.exitCode}).`);
    const stderr = result.stderr.toString().trim();
    if (stderr) console.error(`  ${stderr}`);
    return null;
  }
  try {
    return JSON.parse(result.stdout.toString());
  } catch (err) {
    console.error(`Warning: could not parse GraphQL response: ${(err as Error).message}`);
    return null;
  }
}

async function fetchThreadState(repo: string, number: number): Promise<Map<number, ThreadState> | null> {
  const [owner, name] = repo.split("/");

  const threadQuery = `
    query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              isResolved
              isOutdated
              comments(first: 100) {
                pageInfo { hasNextPage endCursor }
                nodes { databaseId }
              }
            }
          }
        }
      }
    }
  `;

  // Inner pagination: if a single thread has more than 100 comments we have
  // to issue additional queries scoped to that thread to pick up the rest.
  const innerQuery = `
    query($threadId: ID!, $cursor: String) {
      node(id: $threadId) {
        ... on PullRequestReviewThread {
          comments(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { databaseId }
          }
        }
      }
    }
  `;

  const map = new Map<number, ThreadState>();
  let cursor: string | undefined = undefined;

  while (true) {
    const vars: Record<string, string | number> = { owner, name, number };
    if (cursor) vars.cursor = cursor;

    const page = await runGraphQL(threadQuery, vars);
    if (!page) return null;
    const threadsField = page?.data?.repository?.pullRequest?.reviewThreads;
    if (!threadsField) return null;

    for (const t of threadsField.nodes ?? []) {
      const state: ThreadState = { resolved: !!t.isResolved, outdated: !!t.isOutdated };
      for (const c of t.comments?.nodes ?? []) {
        if (typeof c.databaseId === "number") map.set(c.databaseId, state);
      }

      // Paginate inner comments only when this thread overflowed the first 100.
      let innerCursor: string | undefined = t.comments?.pageInfo?.hasNextPage
        ? t.comments.pageInfo.endCursor
        : undefined;
      while (innerCursor) {
        const innerVars: Record<string, string | number> = { threadId: t.id, cursor: innerCursor };
        const innerPage = await runGraphQL(innerQuery, innerVars);
        if (!innerPage) return null;
        const innerComments = innerPage?.data?.node?.comments;
        if (!innerComments) break;
        for (const c of innerComments.nodes ?? []) {
          if (typeof c.databaseId === "number") map.set(c.databaseId, state);
        }
        innerCursor = innerComments.pageInfo?.hasNextPage ? innerComments.pageInfo.endCursor : undefined;
      }
    }

    if (!threadsField.pageInfo?.hasNextPage) break;
    cursor = threadsField.pageInfo.endCursor;
  }

  return map;
}

async function resolvePr(arg: string | undefined): Promise<{ repo: string; number: number }> {
  const urlMatch = arg?.match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/);
  if (urlMatch) return { repo: urlMatch[1], number: Number(urlMatch[2]) };

  const repoResult = await $`gh repo view --json nameWithOwner -q .nameWithOwner`.quiet().nothrow();
  if (repoResult.exitCode !== 0) {
    console.error("Could not determine the GitHub repo for the current directory.");
    console.error("Run this inside a repo with a GitHub remote, or pass a PR URL instead:");
    console.error("  bun run pr:comments https://github.com/oven-sh/bun/pull/28838");
    process.exit(1);
  }
  const repo = repoResult.stdout.toString().trim();

  if (arg) {
    const n = Number(arg.replace(/^#/, ""));
    if (!Number.isFinite(n)) {
      console.error(`Error: "${arg}" is not a PR number or URL.`);
      console.error(`Usage: bun run pr:comments [<number> | #<number> | <url>]`);
      process.exit(1);
    }
    return { repo, number: n };
  }

  // No argument — look up a PR for the current branch.
  const branch = (await $`git branch --show-current`.quiet().text()).trim();
  const lookup = await $`gh pr view --json number 2>&1`.quiet().nothrow();
  if (lookup.exitCode !== 0) {
    console.error(`No pull request found for the current branch (${branch || "detached HEAD"}).`);
    console.error("");
    console.error("Options:");
    console.error("  - Pass a PR number:        bun run pr:comments 28838");
    console.error("  - Pass a PR URL:           bun run pr:comments https://github.com/oven-sh/bun/pull/28838");
    console.error("  - Push this branch and open a PR first");
    process.exit(1);
  }
  try {
    const view = JSON.parse(lookup.stdout.toString().trim());
    return { repo, number: view.number };
  } catch {
    console.error(`Could not parse "gh pr view" output. Pass a PR number or URL instead.`);
    process.exit(1);
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 16);
}

function truncateBody(body: string, max = 600): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + `\n  ... [${trimmed.length - max} more chars]`;
}

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map(l => prefix + l)
    .join("\n");
}

// https://docs.github.com/en/rest/pulls/reviews — review `state` values:
//   APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING
function labelForReviewState(state: string | undefined): string {
  switch (state) {
    case "APPROVED":
      return "review (approved)";
    case "CHANGES_REQUESTED":
      return "review (changes requested)";
    case "COMMENTED":
      return "review (comment)";
    case "DISMISSED":
      return "review (dismissed)";
    case "PENDING":
      return "review (pending)";
    default:
      return `review (${(state ?? "unknown").toLowerCase()})`;
  }
}

// Every line-level comment is attached to a review container in GitHub's data
// model, even single-comment reviews from "Add single comment" on the Files
// changed tab. We only need to distinguish replies from top-level line comments.
// A body containing a ```suggestion``` block is marked as an applicable suggestion.
function labelForReviewComment(c: Json): string {
  let base = c.in_reply_to_id ? "reply" : "line comment";
  if (typeof c.body === "string" && /```suggestion\b/.test(c.body)) {
    base += " + suggestion";
  }
  return base;
}

const rawArgs = process.argv.slice(2);
const jsonMode = rawArgs.includes("--json");
const positional = rawArgs.filter(a => !a.startsWith("--"))[0];

const { repo, number } = await resolvePr(positional);

const [issueComments, reviews, reviewComments, threadState] = await Promise.all([
  gh(`repos/${repo}/issues/${number}/comments`),
  gh(`repos/${repo}/pulls/${number}/reviews`),
  gh(`repos/${repo}/pulls/${number}/comments`),
  fetchThreadState(repo, number),
]);

type Entry = {
  when: string;
  user: string;
  kind: string;
  location?: string;
  body: string;
  url?: string;
  resolved?: boolean | null;
  outdated?: boolean | null;
};

const entries: Entry[] = [];

for (const c of issueComments) {
  entries.push({
    when: c.created_at,
    user: c.user?.login ?? "?",
    kind: "issue comment",
    body: c.body ?? "",
    url: c.html_url,
  });
}

for (const r of reviews) {
  // Skip the empty "COMMENTED" review stub that GitHub emits as a container
  // for line-level comments — the real content is in reviewComments below.
  if (!r.body && r.state === "COMMENTED") continue;
  entries.push({
    when: r.submitted_at,
    user: r.user?.login ?? "?",
    kind: labelForReviewState(r.state),
    body: r.body || "(no body)",
    url: r.html_url,
  });
}

for (const c of reviewComments) {
  const loc = c.path ? `${c.path}${c.line ? `:${c.line}` : ""}` : undefined;
  // null means "unknown" — either the GraphQL fetch failed, or the comment
  // isn't in the (paginated) thread set we fetched. Both are distinct from a
  // confirmed false, so we keep them null rather than assuming resolved=false.
  const state = threadState?.get(c.id);
  entries.push({
    when: c.created_at,
    user: c.user?.login ?? "?",
    kind: labelForReviewComment(c),
    location: loc,
    body: c.body ?? "",
    url: c.html_url,
    resolved: state ? state.resolved : null,
    outdated: state ? state.outdated : null,
  });
}

entries.sort((a, b) => a.when.localeCompare(b.when));

if (jsonMode) {
  process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
  process.exit(0);
}

// Summary header — group by kind so you can see at a glance what's there.
const byKind = new Map<string, number>();
for (const e of entries) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);

console.log(`PR: ${repo}#${number}`);
console.log(`URL: https://github.com/${repo}/pull/${number}`);
if (entries.length === 0) {
  console.log("");
  console.log("(no comments)");
  process.exit(0);
}
// Naive `+ "s"` mangles labels like "review (comment)" and "reply", so the
// plural form is spelled out per kind here.
const pluralLabels: Record<string, string> = {
  "issue comment": "issue comments",
  "line comment": "line comments",
  reply: "replies",
  "line comment + suggestion": "line comments + suggestions",
  "reply + suggestion": "replies + suggestions",
  "review (approved)": "reviews (approved)",
  "review (changes requested)": "reviews (changes requested)",
  "review (comment)": "reviews (comment)",
  "review (dismissed)": "reviews (dismissed)",
  "review (pending)": "reviews (pending)",
};
const summary = [...byKind.entries()].map(([k, n]) => `${n} ${n === 1 ? k : (pluralLabels[k] ?? k + "s")}`).join(", ");
console.log(`Found: ${summary}`);

// Count how many line comments / replies still need attention vs. done.
// Only thread-capable entries (those where resolved !== undefined) contribute.
let unresolvedCount = 0;
let resolvedCount = 0;
let outdatedCount = 0;
for (const e of entries) {
  if (e.resolved === true) resolvedCount++;
  else if (e.resolved === false) unresolvedCount++;
  if (e.outdated === true) outdatedCount++;
}
if (resolvedCount || unresolvedCount) {
  const parts: string[] = [];
  if (unresolvedCount) parts.push(`${unresolvedCount} unresolved`);
  if (resolvedCount) parts.push(`${resolvedCount} resolved`);
  if (outdatedCount) parts.push(`${outdatedCount} outdated`);
  console.log(`Threads: ${parts.join(", ")}`);
}
console.log("");

console.log("Legend:");
console.log("  issue comment  — general conversation on the PR (Conversation tab)");
console.log("  review (*)     — top-level review verdict (approved / changes requested / comment)");
console.log("  line comment   — inline comment on a specific file line (Files changed tab)");
console.log("  reply          — threaded reply to another line comment");
console.log("  + suggestion   — body contains a ```suggestion``` block a maintainer can apply");
console.log("  [resolved]     — reviewer marked this thread resolved; no action needed");
console.log("  [outdated]     — the line this comment was attached to has since moved");
console.log("");

for (const e of entries) {
  const flags: string[] = [];
  if (e.resolved === true) flags.push("resolved");
  if (e.outdated === true) flags.push("outdated");
  const flagSegment = flags.length ? `[${flags.join(", ")}]` : undefined;
  const header = [fmtDate(e.when), e.user, e.kind, e.location, flagSegment].filter(Boolean).join(" | ");
  console.log("---");
  console.log(header);
  console.log(indent(truncateBody(e.body)));
}
