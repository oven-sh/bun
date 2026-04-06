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
//   { when, user, kind, location?, body, url? }
// so you can filter with jq, e.g.:
//   bun run pr:comments 28838 --json | jq '.[] | select(.user == "Jarred-Sumner")'
//   bun run pr:comments 28838 --json | jq '[.[] | select(.kind == "line comment")]'

import { $ } from "bun";

type Json = Record<string, any>;

async function gh(path: string): Promise<Json[]> {
  const out = await $`gh api ${path}`.quiet().text();
  return JSON.parse(out);
}

async function resolvePr(arg: string | undefined): Promise<{ repo: string; number: number }> {
  const urlMatch = arg?.match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/);
  if (urlMatch) return { repo: urlMatch[1], number: Number(urlMatch[2]) };

  const repo = (await $`gh repo view --json nameWithOwner -q .nameWithOwner`.quiet().text()).trim();

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

const [issueComments, reviews, reviewComments] = await Promise.all([
  gh(`repos/${repo}/issues/${number}/comments`),
  gh(`repos/${repo}/pulls/${number}/reviews`),
  gh(`repos/${repo}/pulls/${number}/comments`),
]);

type Entry = {
  when: string;
  user: string;
  kind: string;
  location?: string;
  body: string;
  url?: string;
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
  entries.push({
    when: c.created_at,
    user: c.user?.login ?? "?",
    kind: labelForReviewComment(c),
    location: loc,
    body: c.body ?? "",
    url: c.html_url,
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
const summary = [...byKind.entries()].map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ");
console.log(`Found: ${summary}`);
console.log("");

console.log("Legend:");
console.log("  issue comment  — general conversation on the PR (Conversation tab)");
console.log("  review (*)     — top-level review verdict (approved / changes requested / comment)");
console.log("  line comment   — inline comment on a specific file line (Files changed tab)");
console.log("  reply          — threaded reply to another line comment");
console.log("  + suggestion   — body contains a ```suggestion``` block a maintainer can apply");
console.log("");

for (const e of entries) {
  const header = [fmtDate(e.when), e.user, e.kind, e.location].filter(Boolean).join(" | ");
  console.log("---");
  console.log(header);
  console.log(indent(truncateBody(e.body)));
}
