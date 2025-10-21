#!/usr/bin/env bun

declare global {
  var process: {
    env: Record<string, string | undefined>;
  };
}

interface GitHubIssue {
  number: number;
  title: string;
  user: { id: number };
  created_at: string;
  pull_request?: object;
}

interface GitHubComment {
  id: number;
  body: string;
  created_at: string;
  user: { type?: string; id: number };
}

interface GitHubReaction {
  user: { id: number };
  content: string;
}

async function githubRequest<T>(endpoint: string, token: string, method: string = "GET", body?: any): Promise<T> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "auto-close-duplicates-script",
      ...(body && { "Content-Type": "application/json" }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchAllComments(
  owner: string,
  repo: string,
  issueNumber: number,
  token: string,
): Promise<GitHubComment[]> {
  const allComments: GitHubComment[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const comments: GitHubComment[] = await githubRequest(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=${perPage}&page=${page}`,
      token,
    );

    if (comments.length === 0) break;

    allComments.push(...comments);
    page++;

    // Safety limit
    if (page > 20) break;
  }

  return allComments;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractDuplicateIssueNumber(commentBody: string, owner: string, repo: string): number | null {
  // Escape owner and repo to prevent ReDoS attacks
  const escapedOwner = escapeRegExp(owner);
  const escapedRepo = escapeRegExp(repo);

  // Try to match same-repo GitHub issue URL format first: https://github.com/owner/repo/issues/123
  const repoUrlPattern = new RegExp(`github\\.com/${escapedOwner}/${escapedRepo}/issues/(\\d+)`);
  let match = commentBody.match(repoUrlPattern);
  if (match) {
    return parseInt(match[1], 10);
  }

  // Fallback to #123 format (assumes same repo)
  match = commentBody.match(/#(\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }

  return null;
}

async function closeIssueAsDuplicate(
  owner: string,
  repo: string,
  issueNumber: number,
  duplicateOfNumber: number,
  token: string,
): Promise<void> {
  // Close the issue with state_reason "not_planned" (GitHub doesn't have a "duplicate" state_reason in the API)
  await githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, token, "PATCH", {
    state: "closed",
    state_reason: "not_planned",
  });

  await githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, token, "POST", {
    body: `This issue has been automatically closed as a duplicate of #${duplicateOfNumber}.

If this is incorrect, please re-open this issue or create a new one.

🤖 Generated with [Claude Code](https://claude.ai/code)`,
  });
}

async function autoCloseDuplicates(): Promise<void> {
  console.log("[DEBUG] Starting auto-close duplicates script");

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }
  console.log("[DEBUG] GitHub token found");

  // Parse GITHUB_REPOSITORY (format: "owner/repo")
  const repository = process.env.GITHUB_REPOSITORY || "oven-sh/bun";
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY format: ${repository}`);
  }
  console.log(`[DEBUG] Repository: ${owner}/${repo}`);

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  console.log(`[DEBUG] Checking for duplicate comments older than: ${threeDaysAgo.toISOString()}`);

  console.log("[DEBUG] Fetching open issues created more than 3 days ago...");
  const allIssues: GitHubIssue[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const pageIssues: GitHubIssue[] = await githubRequest(
      `/repos/${owner}/${repo}/issues?state=open&per_page=${perPage}&page=${page}`,
      token,
    );

    if (pageIssues.length === 0) break;

    // Filter for issues created more than 3 days ago and exclude pull requests
    const oldEnoughIssues = pageIssues.filter(
      issue => !issue.pull_request && new Date(issue.created_at) <= threeDaysAgo,
    );

    allIssues.push(...oldEnoughIssues);
    page++;

    // Safety limit to avoid infinite loops
    if (page > 20) break;
  }

  const issues = allIssues;
  console.log(`[DEBUG] Found ${issues.length} open issues`);

  let processedCount = 0;
  let candidateCount = 0;

  for (const issue of issues) {
    processedCount++;
    console.log(`[DEBUG] Processing issue #${issue.number} (${processedCount}/${issues.length}): ${issue.title}`);

    console.log(`[DEBUG] Fetching comments for issue #${issue.number}...`);
    const comments = await fetchAllComments(owner, repo, issue.number, token);
    console.log(`[DEBUG] Issue #${issue.number} has ${comments.length} comments`);

    const dupeComments = comments.filter(
      comment =>
        comment.body.includes("Found") &&
        comment.body.includes("possible duplicate") &&
        comment.user?.type === "Bot" &&
        comment.body.includes("<!-- dedupe-bot:marker -->"),
    );
    console.log(`[DEBUG] Issue #${issue.number} has ${dupeComments.length} duplicate detection comments`);

    if (dupeComments.length === 0) {
      console.log(`[DEBUG] Issue #${issue.number} - no duplicate comments found, skipping`);
      continue;
    }

    const lastDupeComment = dupeComments[dupeComments.length - 1];
    const dupeCommentDate = new Date(lastDupeComment.created_at);
    console.log(
      `[DEBUG] Issue #${issue.number} - most recent duplicate comment from: ${dupeCommentDate.toISOString()}`,
    );

    if (dupeCommentDate > threeDaysAgo) {
      console.log(`[DEBUG] Issue #${issue.number} - duplicate comment is too recent, skipping`);
      continue;
    }
    console.log(
      `[DEBUG] Issue #${issue.number} - duplicate comment is old enough (${Math.floor(
        (Date.now() - dupeCommentDate.getTime()) / (1000 * 60 * 60 * 24),
      )} days)`,
    );

    // Filter for human comments (not bot comments) after the duplicate comment
    const commentsAfterDupe = comments.filter(
      comment => new Date(comment.created_at) > dupeCommentDate && comment.user?.type !== "Bot",
    );
    console.log(
      `[DEBUG] Issue #${issue.number} - ${commentsAfterDupe.length} human comments after duplicate detection`,
    );

    if (commentsAfterDupe.length > 0) {
      console.log(`[DEBUG] Issue #${issue.number} - has human activity after duplicate comment, skipping`);
      continue;
    }

    console.log(`[DEBUG] Issue #${issue.number} - checking reactions on duplicate comment...`);
    const reactions: GitHubReaction[] = await githubRequest(
      `/repos/${owner}/${repo}/issues/comments/${lastDupeComment.id}/reactions`,
      token,
    );
    console.log(`[DEBUG] Issue #${issue.number} - duplicate comment has ${reactions.length} reactions`);

    const authorThumbsDown = reactions.some(
      reaction => reaction.user.id === issue.user.id && reaction.content === "-1",
    );
    console.log(`[DEBUG] Issue #${issue.number} - author thumbs down reaction: ${authorThumbsDown}`);

    if (authorThumbsDown) {
      console.log(`[DEBUG] Issue #${issue.number} - author disagreed with duplicate detection, skipping`);
      continue;
    }

    const duplicateIssueNumber = extractDuplicateIssueNumber(lastDupeComment.body, owner, repo);
    if (!duplicateIssueNumber) {
      console.log(`[DEBUG] Issue #${issue.number} - could not extract duplicate issue number from comment, skipping`);
      continue;
    }

    candidateCount++;
    const issueUrl = `https://github.com/${owner}/${repo}/issues/${issue.number}`;

    try {
      console.log(`[INFO] Auto-closing issue #${issue.number} as duplicate of #${duplicateIssueNumber}: ${issueUrl}`);
      await closeIssueAsDuplicate(owner, repo, issue.number, duplicateIssueNumber, token);
      console.log(`[SUCCESS] Successfully closed issue #${issue.number} as duplicate of #${duplicateIssueNumber}`);
    } catch (error) {
      console.error(`[ERROR] Failed to close issue #${issue.number} as duplicate: ${error}`);
    }
  }

  console.log(
    `[DEBUG] Script completed. Processed ${processedCount} issues, found ${candidateCount} candidates for auto-close`,
  );
}

autoCloseDuplicates().catch(console.error);

// Make it a module
export {};
