#!/usr/bin/env bun
/**
 * discuss.ts - PR Review Comment Manager
 *
 * A CLI tool to fetch, organize, and track resolution of GitHub PR review comments.
 * Uses Bun's native SQLite and shell capabilities.
 *
 * Usage:
 *   bun discuss.ts fetch [pr-number]    - Fetch comments from GitHub
 *   bun discuss.ts list [--priority X]  - List comments (filtered by priority)
 *   bun discuss.ts show <id>            - Show full comment details
 *   bun discuss.ts note <id> <text>     - Add a note to a comment
 *   bun discuss.ts resolve <id> [commit] - Mark comment as resolved
 *   bun discuss.ts unresolve <id>       - Mark comment as unresolved
 *   bun discuss.ts pending              - Show only unresolved comments
 *   bun discuss.ts stats                - Show summary statistics
 */

import { $ } from "bun";
import { Database } from "bun:sqlite";

const DB_PATH = "./discuss.sqlite";
const DEFAULT_PR = "23798";
const REPO = "oven-sh/bun";

// Initialize database once at module level
const db = (() => {
  const database = new Database(DB_PATH);
  database.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      line INTEGER,
      body TEXT NOT NULL,
      priority TEXT NOT NULL,
      severity TEXT NOT NULL,
      outdated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      user TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      thread_id TEXT,
      github_resolved INTEGER NOT NULL DEFAULT 0,
      resolved_commit TEXT,
      waiting_reply INTEGER NOT NULL DEFAULT 0,
      snoozed_reply_count INTEGER DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY,
      in_reply_to_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      user TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (in_reply_to_id) REFERENCES comments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_github_resolved ON comments(github_resolved);
    CREATE INDEX IF NOT EXISTS idx_priority ON comments(priority);
    CREATE INDEX IF NOT EXISTS idx_path ON comments(path);
    CREATE INDEX IF NOT EXISTS idx_replies_parent ON replies(in_reply_to_id);
  `);
  return database;
})();

interface Comment {
  id: number;
  path: string;
  line: number | null;
  body: string;
  priority: string;
  severity: string;
  outdated: boolean;
  created_at: string;
  updated_at: string;
  user: string;
  first_seen: string;
  thread_id: string | null;
  github_resolved: boolean;
  resolved_commit: string | null;
  waiting_reply: boolean;
  notes: string | null;
}

interface Reply {
  id: number;
  in_reply_to_id: number;
  body: string;
  user: string;
  created_at: string;
  updated_at: string;
}

// Parse priority and severity from comment body
function parseComment(body: string): { priority: string; severity: string } {
  const lines = body.split("\n");
  const firstLine = lines[0] || "";

  // Parse markers like: _🧹 Nitpick_ | _🔵 Trivial_
  const priorityMap: Record<string, string> = {
    "⚠️ Potential issue": "issue",
    "🛠️ Refactor suggestion": "refactor",
    "🧹 Nitpick": "nitpick",
  };

  const severityMap: Record<string, string> = {
    "🔴 Critical": "critical",
    "🟠 Major": "major",
    "🟡 Minor": "minor",
    "🔵 Trivial": "trivial",
  };

  let priority = "unknown";
  let severity = "unknown";

  for (const [marker, val] of Object.entries(priorityMap)) {
    if (firstLine.includes(marker)) {
      priority = val;
      break;
    }
  }

  for (const [marker, val] of Object.entries(severityMap)) {
    if (firstLine.includes(marker)) {
      severity = val;
      break;
    }
  }

  return { priority, severity };
}

/**
 * Resolve a thread on GitHub via GraphQL mutation
 */
async function resolveThreadOnGitHub(threadId: string): Promise<boolean> {
  if (!threadId) {
    console.warn(`⚠️ No thread ID to resolve`);
    return false;
  }

  try {
    const result = await $`gh api graphql -F threadId="${threadId}" -f query='
      mutation ResolveThread($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
          thread {
            id
            isResolved
          }
        }
      }'`.json();

    if (result.data?.resolveReviewThread?.thread?.isResolved) {
      console.log(`✅ Resolved thread on GitHub: ${threadId}`);
      return true;
    } else {
      console.warn(`⚠️ Failed to resolve thread: ${threadId}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error resolving thread:`, error);
    return false;
  }
}

/**
 * Unresolve a thread on GitHub via GraphQL mutation
 */
async function unresolveThreadOnGitHub(threadId: string): Promise<boolean> {
  if (!threadId) {
    console.warn(`⚠️ No thread ID to unresolve`);
    return false;
  }

  try {
    const result = await $`gh api graphql -F threadId="${threadId}" -f query='
      mutation UnresolveThread($threadId: ID!) {
        unresolveReviewThread(input: { threadId: $threadId }) {
          thread {
            id
            isResolved
          }
        }
      }'`.json();

    if (!result.data?.unresolveReviewThread?.thread?.isResolved) {
      console.log(`✅ Unresolved thread on GitHub: ${threadId}`);
      return true;
    } else {
      console.warn(`⚠️ Failed to unresolve thread: ${threadId}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error unresolving thread:`, error);
    return false;
  }
}

// Fetch comments from GitHub API
async function fetchComments(prNumber: string = DEFAULT_PR): Promise<void> {
  console.log(`📥 Fetching comments for PR #${prNumber}...`);

  try {
    // Step 1: Fetch comments via REST API
    const result = await $`gh api repos/${REPO}/pulls/${prNumber}/comments --paginate`.json();
    const comments = Array.isArray(result) ? result : [];

    // Separate top-level comments and replies
    const topLevel = comments.filter((c: any) => !c.in_reply_to_id);
    const replies = comments.filter((c: any) => c.in_reply_to_id);

    console.log(`   Found ${topLevel.length} top-level comments, ${replies.length} replies`);

    // Step 2: Fetch ALL threads + resolution status + outdated status via GraphQL (with pagination)
    console.log(`   Fetching thread resolution and outdated status from GitHub...`);
    const threadInfo = new Map<number, { threadId: string; isResolved: boolean; isOutdated: boolean }>();
    let hasNextPage = true;
    let cursor: string | null = null;
    let pageCount = 0;

    while (hasNextPage) {
      pageCount++;
      const cursorArg = cursor ? `, after: "${cursor}"` : "";

      const threadsResult = await $`gh api graphql -f query='
{
  repository(owner: "oven-sh", name: "bun") {
    pullRequest(number: ${prNumber}) {
      reviewThreads(first: 100${cursorArg}) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 100) {
            nodes {
              databaseId
              outdated
            }
          }
        }
      }
    }
  }
}'`.json();

      const threads = threadsResult.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
      const pageInfo = threadsResult.data?.repository?.pullRequest?.reviewThreads?.pageInfo;

      console.log(`   Page ${pageCount}: Found ${threads.length} threads`);

      // Build thread mapping for this page
      for (const thread of threads) {
        for (const comment of thread.comments.nodes) {
          // databaseId is the integer comment ID we track
          threadInfo.set(comment.databaseId, {
            threadId: thread.id,
            isResolved: thread.isResolved,
            isOutdated: comment.outdated, // Use comment-level outdated status
          });
        }
      }

      hasNextPage = pageInfo?.hasNextPage || false;
      cursor = pageInfo?.endCursor || null;
    }

    console.log(`   Total: ${threadInfo.size} comments mapped to threads across ${pageCount} pages`);

    // Step 3: Store comments with GitHub resolution state
    const now = new Date().toISOString();

    const insert = db.prepare(`
      INSERT OR REPLACE INTO comments (
        id, path, line, body, priority, severity, outdated,
        created_at, updated_at, user, first_seen,
        thread_id, github_resolved, resolved_commit, waiting_reply, snoozed_reply_count, notes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        COALESCE((SELECT first_seen FROM comments WHERE id = ?), ?),
        ?, ?,
        (SELECT resolved_commit FROM comments WHERE id = ?),
        COALESCE((SELECT waiting_reply FROM comments WHERE id = ?), 0),
        COALESCE((SELECT snoozed_reply_count FROM comments WHERE id = ?), 0),
        (SELECT notes FROM comments WHERE id = ?)
      )
    `);

    const insertReply = db.prepare(`
      INSERT OR REPLACE INTO replies (
        id, in_reply_to_id, body, user, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    let newCount = 0;
    let updatedCount = 0;

    for (const comment of topLevel) {
      const { priority, severity } = parseComment(comment.body);
      const existing = db.query("SELECT id FROM comments WHERE id = ?").get(comment.id);

      // Get thread info from our map (defaults if not found)
      const info = threadInfo.get(comment.id) || { threadId: null, isResolved: false, isOutdated: false };

      insert.run(
        comment.id,
        comment.path,
        comment.line,
        comment.body,
        priority,
        severity,
        info.isOutdated ? 1 : 0, // Use outdated status from GraphQL
        comment.created_at,
        comment.updated_at,
        comment.user.login,
        comment.id,
        now, // first_seen COALESCE
        info.threadId, // Thread ID from GitHub
        info.isResolved ? 1 : 0, // Resolution status from GitHub
        comment.id, // resolved_commit COALESCE
        comment.id, // waiting_reply COALESCE
        comment.id, // snoozed_reply_count COALESCE
        comment.id, // notes COALESCE
      );

      if (existing) {
        updatedCount++;
      } else {
        newCount++;
      }
    }

    // Import replies
    let replyCount = 0;
    for (const reply of replies) {
      insertReply.run(reply.id, reply.in_reply_to_id, reply.body, reply.user.login, reply.created_at, reply.updated_at);
      replyCount++;
    }

    // Auto-unsnooze: Check snoozed comments for new replies
    const snoozedComments = db.query("SELECT id, snoozed_reply_count FROM comments WHERE waiting_reply = 1").all() as {
      id: number;
      snoozed_reply_count: number;
    }[];

    let unsnoozedCount = 0;
    for (const snoozed of snoozedComments) {
      const currentReplyCount = db
        .query("SELECT COUNT(*) as count FROM replies WHERE in_reply_to_id = ?")
        .get(snoozed.id) as { count: number };

      if (currentReplyCount.count > snoozed.snoozed_reply_count) {
        db.prepare("UPDATE comments SET waiting_reply = 0, snoozed_reply_count = 0 WHERE id = ?").run(snoozed.id);
        unsnoozedCount++;
      }
    }

    const resolvedCount = Array.from(threadInfo.values()).filter(t => t.isResolved).length;
    const outdatedCount = Array.from(threadInfo.values()).filter(t => t.isOutdated).length;
    console.log(`✅ Imported ${newCount} new, updated ${updatedCount} existing comments, ${replyCount} replies`);
    console.log(`   ${resolvedCount} threads marked as resolved on GitHub`);
    console.log(`   ${outdatedCount} comments marked as outdated`);
    if (unsnoozedCount > 0) {
      console.log(`   🔔 Auto-unsnoozed ${unsnoozedCount} comments with new replies`);
    }
  } catch (error) {
    console.error(`❌ Failed to fetch comments:`, error);
    process.exit(1);
  }
}

// List comments
function listComments(priorityFilter?: string): void {
  let query = "SELECT * FROM comments";
  const params: any[] = [];

  if (priorityFilter) {
    query += " WHERE severity = ?";
    params.push(priorityFilter);
  }

  query +=
    " ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 WHEN 'minor' THEN 3 WHEN 'trivial' THEN 4 ELSE 5 END, github_resolved ASC, path";

  const comments = db.query(query).all(...params) as Comment[];

  if (comments.length === 0) {
    console.log("No comments found.");
    return;
  }

  const severityEmoji: Record<string, string> = {
    critical: "🔴",
    major: "🟠",
    minor: "🟡",
    trivial: "🔵",
    unknown: "⚪",
  };

  const priorityEmoji: Record<string, string> = {
    issue: "⚠️",
    refactor: "🛠️",
    nitpick: "🧹",
    unknown: "❓",
  };

  let lastSeverity = "";

  for (const comment of comments) {
    if (comment.severity !== lastSeverity) {
      console.log(`\n${severityEmoji[comment.severity] || "⚪"} ${comment.severity.toUpperCase()}`);
      lastSeverity = comment.severity;
    }

    const status = comment.github_resolved ? "✅" : "  ";
    const outdated = comment.outdated ? "(outdated)" : "";
    const lineInfo = comment.line ? `:${comment.line}` : "";

    console.log(
      `  ${status} [${comment.id}] ${priorityEmoji[comment.priority] || ""} ${comment.path}${lineInfo} ${outdated}`,
    );

    // Show first line of issue
    const firstLine = comment.body.split("\n").find(l => l.startsWith("**")) || "";
    if (firstLine) {
      console.log(`      ${firstLine.replace(/\*\*/g, "").substring(0, 80)}`);
    }
  }

  console.log();
}

// Search comments by text
function searchComments(query: string, showResolved: boolean = false): void {
  const resolvedFilter = showResolved ? "" : "AND github_resolved = 0";

  const comments = db
    .query(
      `
    SELECT * FROM comments
    WHERE (body LIKE ? OR path LIKE ?)
    ${resolvedFilter}
    ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'major' THEN 2 WHEN 'minor' THEN 3 WHEN 'trivial' THEN 4 ELSE 5 END,
             github_resolved ASC, path
  `,
    )
    .all(`%${query}%`, `%${query}%`) as Comment[];

  if (comments.length === 0) {
    console.log(`🔍 No comments found matching: "${query}"`);
    return;
  }

  const severityEmoji: Record<string, string> = {
    critical: "🔴",
    major: "🟠",
    minor: "🟡",
    trivial: "🔵",
    unknown: "⚪",
  };

  const priorityEmoji: Record<string, string> = {
    issue: "⚠️",
    refactor: "🛠️",
    nitpick: "🧹",
    unknown: "❓",
  };

  console.log(`\n🔍 Found ${comments.length} comment(s) matching: "${query}"`);
  console.log();

  let lastSeverity = "";

  for (const comment of comments) {
    if (comment.severity !== lastSeverity) {
      console.log(`\n${severityEmoji[comment.severity] || "⚪"} ${comment.severity.toUpperCase()}`);
      lastSeverity = comment.severity;
    }

    const status = comment.github_resolved ? "✅" : "  ";
    const outdated = comment.outdated ? "(outdated)" : "";
    const snoozed = comment.waiting_reply ? "😴" : "";
    const lineInfo = comment.line ? `:${comment.line}` : "";

    console.log(
      `  ${status}${snoozed} [${comment.id}] ${priorityEmoji[comment.priority] || ""} ${comment.path}${lineInfo} ${outdated}`,
    );

    // Show first meaningful line of issue
    const firstLine = comment.body.split("\n").find(l => l.startsWith("**")) || "";
    if (firstLine) {
      console.log(`      ${firstLine.replace(/\*\*/g, "").substring(0, 80)}`);
    }
  }

  console.log();
}

// Show comment details
function showComment(id: string): void {
  const comment = db.query("SELECT * FROM comments WHERE id = ?").get(parseInt(id)) as Comment | null;

  if (!comment) {
    console.error(`❌ Comment #${id} not found`);
    process.exit(1);
  }

  // Get replies
  const replies = db
    .query("SELECT * FROM replies WHERE in_reply_to_id = ? ORDER BY created_at")
    .all(parseInt(id)) as Reply[];

  console.log(`\n📝 Comment #${comment.id}`);
  console.log(`   File: ${comment.path}${comment.line ? `:${comment.line}` : ""}`);
  console.log(`   Priority: ${comment.priority} | Severity: ${comment.severity}`);

  // Show resolution status from GitHub
  const status = comment.github_resolved ? "✅ Resolved" : "⏳ Pending";
  console.log(`   Status: ${status}${comment.waiting_reply ? " (snoozed)" : ""}`);

  if (comment.github_resolved && comment.resolved_commit) {
    console.log(`   Resolved in: ${comment.resolved_commit}`);
  }

  if (comment.thread_id) {
    console.log(`   Thread ID: ${comment.thread_id}`);
  }

  console.log(`   Created: ${comment.created_at}`);
  console.log(`   Updated: ${comment.updated_at}`);
  console.log(`   First seen: ${comment.first_seen}`);
  console.log(`   Author: ${comment.user}`);
  if (comment.outdated) {
    console.log(`   ⚠️  OUTDATED`);
  }

  // Show the original comment body first
  console.log(`\n   Body:`);
  console.log(
    `   ${comment.body
      .split("\n")
      .map(l => "   " + l)
      .join("\n")}`,
  );

  // Then show replies chronologically
  if (replies.length > 0) {
    console.log(`\n   💬 ${replies.length} ${replies.length === 1 ? "Reply" : "Replies"}:`);
    for (const reply of replies) {
      console.log(`\n   ┌─ ${reply.user} @ ${new Date(reply.created_at).toLocaleString()}`);
      const lines = reply.body.split("\n");
      for (const line of lines.slice(0, 10)) {
        // Show first 10 lines of each reply
        console.log(`   │  ${line}`);
      }
      if (lines.length > 10) {
        console.log(`   │  ... (${lines.length - 10} more lines)`);
      }
      console.log(`   └─`);
    }
  }

  // Finally show our notes at the end
  if (comment.notes) {
    console.log(`\n   📌 Notes:`);
    console.log(`   ${comment.notes.split("\n").join("\n   ")}`);
  }

  console.log();
}

// Add note to comment
function addNote(id: string, noteText: string): void {
  const existing = db.query("SELECT notes FROM comments WHERE id = ?").get(parseInt(id)) as {
    notes: string | null;
  } | null;

  if (!existing) {
    console.error(`❌ Comment #${id} not found`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  const newNote = `[${timestamp}] ${noteText}`;
  const updatedNotes = existing.notes ? `${existing.notes}\n${newNote}` : newNote;

  db.prepare("UPDATE comments SET notes = ? WHERE id = ?").run(updatedNotes, parseInt(id));

  console.log(`✅ Added note to comment #${id}`);
}

// Resolve comment
async function resolveComment(id: string, commit?: string, replyMessage?: string): Promise<void> {
  // Get comment details including thread ID
  const comment = db.query("SELECT thread_id, path FROM comments WHERE id = ?").get(parseInt(id)) as {
    thread_id: string | null;
    path: string;
  } | null;

  if (!comment) {
    console.error(`❌ Comment #${id} not found`);
    process.exit(1);
  }

  if (!comment.thread_id) {
    console.warn(`⚠️ No thread ID for comment #${id} - cannot resolve on GitHub`);
    console.warn(`   Try running: bun discuss.ts fetch`);
    process.exit(1);
  }

  // Step 1: Optionally post a reply
  if (replyMessage) {
    console.log(`💬 Posting reply to comment #${id}...`);
    try {
      await replyToComment(id, replyMessage);
      console.log(`✅ Reply posted`);
    } catch (error) {
      console.error(`❌ Failed to post reply:`, error);
      // Continue anyway - reply is optional
    }
  }

  // Step 2: Resolve the thread on GitHub
  console.log(`🔄 Resolving thread on GitHub...`);
  const resolved = await resolveThreadOnGitHub(comment.thread_id);

  if (!resolved) {
    console.error(`❌ Failed to resolve thread on GitHub`);
    process.exit(1);
  }

  // Step 3: Update local metadata (commit note)
  const resolvedCommit = commit || "HEAD";
  db.prepare("UPDATE comments SET resolved_commit = ? WHERE id = ?").run(resolvedCommit, parseInt(id));

  // Step 4: Re-sync to update local DB with GitHub state
  console.log(`🔄 Re-syncing with GitHub...`);
  await fetchComments(); // Re-fetch to update github_resolved column

  console.log(`✅ Comment #${id} resolved (commit: ${resolvedCommit})`);
}

// Unresolve comment
async function unresolveComment(id: string): Promise<void> {
  // Get comment details including thread ID
  const comment = db.query("SELECT thread_id FROM comments WHERE id = ?").get(parseInt(id)) as {
    thread_id: string | null;
  } | null;

  if (!comment) {
    console.error(`❌ Comment #${id} not found`);
    process.exit(1);
  }

  if (!comment.thread_id) {
    console.warn(`⚠️ No thread ID for comment #${id} - cannot unresolve on GitHub`);
    console.warn(`   Try running: bun discuss.ts fetch`);
    process.exit(1);
  }

  // Unresolve the thread on GitHub
  console.log(`🔄 Unresolving thread on GitHub...`);
  const unresolved = await unresolveThreadOnGitHub(comment.thread_id);

  if (!unresolved) {
    console.error(`❌ Failed to unresolve thread on GitHub`);
    process.exit(1);
  }

  // Clear local metadata
  db.prepare("UPDATE comments SET resolved_commit = NULL WHERE id = ?").run(parseInt(id));

  // Re-sync to update local DB with GitHub state
  console.log(`🔄 Re-syncing with GitHub...`);
  await fetchComments(); // Re-fetch to update github_resolved column

  console.log(`✅ Comment #${id} marked as unresolved`);
}

// Show pending comments only
function showPending(severityFilter?: string, showSnoozed: boolean = false): void {
  // Build WHERE clause based on severity filter
  const severityClause = severityFilter ? `AND severity = '${severityFilter}'` : "";

  const activeComments = db
    .query(
      `
    SELECT * FROM comments
    WHERE github_resolved = 0 ${severityClause} AND waiting_reply = 0
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'major' THEN 2
        WHEN 'minor' THEN 3
        WHEN 'trivial' THEN 4
        ELSE 5
      END,
      path
  `,
    )
    .all() as Comment[];

  // Only fetch snoozed comments if requested
  const snoozedComments = showSnoozed
    ? (db
        .query(
          `
    SELECT * FROM comments
    WHERE github_resolved = 0 ${severityClause} AND waiting_reply = 1
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'major' THEN 2
        WHEN 'minor' THEN 3
        WHEN 'trivial' THEN 4
        ELSE 5
      END,
      path
  `,
        )
        .all() as Comment[])
    : [];

  if (activeComments.length === 0 && snoozedComments.length === 0) {
    const filterMsg = severityFilter ? ` (severity: ${severityFilter})` : "";
    console.log(`🎉 No pending comments${filterMsg}!`);
    return;
  }

  let header = "Pending Comments";
  if (severityFilter) header += ` (severity: ${severityFilter})`;

  if (activeComments.length > 0) {
    console.log(`\n⏳ ${activeComments.length} ${header}\n`);
  }

  const severityEmoji: Record<string, string> = {
    critical: "🔴",
    major: "🟠",
    minor: "🟡",
    trivial: "🔵",
    unknown: "⚪",
  };

  let lastSeverity = "";

  for (const comment of activeComments) {
    if (comment.severity !== lastSeverity) {
      console.log(`\n${severityEmoji[comment.severity]} ${comment.severity.toUpperCase()}`);
      lastSeverity = comment.severity;
    }

    const lineInfo = comment.line ? `:${comment.line}` : "";
    console.log(`  [${comment.id}] ${comment.path}${lineInfo}`);

    // Extract the main suggestion
    const lines = comment.body.split("\n");
    const suggestion = lines.find(l => l.startsWith("**")) || "";
    if (suggestion) {
      const clean = suggestion.replace(/\*\*/g, "").trim();
      console.log(`      → ${clean.substring(0, 100)}${clean.length > 100 ? "..." : ""}`);
    }
  }

  // Only show snoozed section if explicitly requested
  if (showSnoozed && snoozedComments.length > 0) {
    let snoozedHeader = "Snoozed (Waiting for Reply";
    if (severityFilter) snoozedHeader += `, severity: ${severityFilter}`;
    snoozedHeader += ")";
    console.log(`\n\n😴 ${snoozedComments.length} ${snoozedHeader}\n`);

    lastSeverity = "";
    for (const comment of snoozedComments) {
      if (comment.severity !== lastSeverity) {
        console.log(`\n${severityEmoji[comment.severity]} ${comment.severity.toUpperCase()}`);
        lastSeverity = comment.severity;
      }

      const lineInfo = comment.line ? `:${comment.line}` : "";
      console.log(`  [${comment.id}] ${comment.path}${lineInfo}`);

      // Extract the main suggestion
      const lines = comment.body.split("\n");
      const suggestion = lines.find(l => l.startsWith("**")) || "";
      if (suggestion) {
        const clean = suggestion.replace(/\*\*/g, "").trim();
        console.log(`      → ${clean.substring(0, 100)}${clean.length > 100 ? "..." : ""}`);
      }
    }
  }

  console.log();
}

// Reply to a comment on GitHub
async function replyToComment(id: string, replyBody: string): Promise<void> {
  console.log(`💬 Replying to comment #${id}...`);

  try {
    // Get comment details from database
    const comment = db.query("SELECT * FROM comments WHERE id = ?").get(parseInt(id)) as Comment | null;

    if (!comment) {
      console.error(`❌ Comment #${id} not found in database`);
      process.exit(1);
    }

    // Fetch the full comment from GitHub to get commit_id
    const allComments = await $`gh api repos/${REPO}/pulls/${DEFAULT_PR}/comments --paginate`.json();
    const ghComment = Array.isArray(allComments) ? allComments.find((c: any) => c.id === parseInt(id)) : null;

    if (!ghComment) {
      console.error(`❌ Comment #${id} not found on GitHub`);
      process.exit(1);
    }

    // Post reply - use subject_type and in_reply_to for replies
    await $`gh api repos/${REPO}/pulls/${DEFAULT_PR}/comments -X POST -f body=${replyBody} -f subject_type=line -F in_reply_to=${parseInt(id)}`.quiet();

    console.log(`✅ Reply posted to comment #${id}`);
    console.log(`🔄 Refreshing comments...`);

    // Refresh to get the new reply
    await fetchComments(DEFAULT_PR);

    // Auto-snooze AFTER fetching (so the reply count is up to date)
    const currentReplyCount = db
      .query("SELECT COUNT(*) as count FROM replies WHERE in_reply_to_id = ?")
      .get(parseInt(id)) as { count: number };

    db.prepare("UPDATE comments SET waiting_reply = 1, snoozed_reply_count = ? WHERE id = ?").run(
      currentReplyCount.count,
      parseInt(id),
    );

    console.log(`😴 Snoozed - waiting for reply`);
  } catch (error) {
    console.error(`❌ Failed to reply:`, error);
    process.exit(1);
  }
}

// Snooze a comment (waiting for reply)
function snoozeComment(id: string): void {
  // Count current replies before snoozing
  const currentReplyCount = db
    .query("SELECT COUNT(*) as count FROM replies WHERE in_reply_to_id = ?")
    .get(parseInt(id)) as { count: number };

  const result = db
    .prepare("UPDATE comments SET waiting_reply = 1, snoozed_reply_count = ? WHERE id = ?")
    .run(currentReplyCount.count, parseInt(id));

  if (result.changes === 0) {
    console.error(`❌ Comment #${id} not found`);
    process.exit(1);
  }

  console.log(`😴 Snoozed comment #${id} (waiting for reply)`);
}

// Unsnooze a comment
function unsnoozeComment(id: string): void {
  const result = db
    .prepare("UPDATE comments SET waiting_reply = 0, snoozed_reply_count = 0 WHERE id = ?")
    .run(parseInt(id));

  if (result.changes === 0) {
    console.error(`❌ Comment #${id} not found`);
    process.exit(1);
  }

  console.log(`✅ Unsnoozed comment #${id}`);
}

// Unsnooze all comments
function unsnoozeAll(): void {
  const result = db
    .prepare("UPDATE comments SET waiting_reply = 0, snoozed_reply_count = 0 WHERE waiting_reply = 1")
    .run();

  console.log(`✅ Unsnoozed ${result.changes} comments`);
}

// Show statistics
function showStats(): void {
  const total = db.query("SELECT COUNT(*) as count FROM comments").get() as { count: number };
  const resolved = db.query("SELECT COUNT(*) as count FROM comments WHERE github_resolved = 1").get() as {
    count: number;
  };
  const pending = db.query("SELECT COUNT(*) as count FROM comments WHERE github_resolved = 0").get() as {
    count: number;
  };
  const outdated = db.query("SELECT COUNT(*) as count FROM comments WHERE outdated = 1").get() as { count: number };
  const snoozed = db
    .query("SELECT COUNT(*) as count FROM comments WHERE waiting_reply = 1 AND github_resolved = 0")
    .get() as { count: number };

  // Get breakdown by severity for all states
  const bySeverityAll = db
    .query(
      `
    SELECT
      severity,
      SUM(CASE WHEN github_resolved = 0 THEN 1 ELSE 0 END) as pending_count,
      SUM(CASE WHEN github_resolved = 1 THEN 1 ELSE 0 END) as resolved_count,
      SUM(CASE WHEN outdated = 1 THEN 1 ELSE 0 END) as outdated_count
    FROM comments
    GROUP BY severity
    ORDER BY CASE severity
      WHEN 'critical' THEN 1
      WHEN 'major' THEN 2
      WHEN 'minor' THEN 3
      WHEN 'trivial' THEN 4
      ELSE 5
    END
  `,
    )
    .all() as { severity: string; pending_count: number; resolved_count: number; outdated_count: number }[];

  const severityEmoji: Record<string, string> = {
    critical: "🔴",
    major: "🟠",
    minor: "🟡",
    trivial: "🔵",
    unknown: "⚪",
  };

  console.log(`\n# Total Comments: ${total.count}`);

  // Pending section
  console.log(`⏳ Pending comments: ${pending.count}`);
  for (const row of bySeverityAll) {
    if (row.pending_count > 0) {
      const emoji = severityEmoji[row.severity] || "⚪";
      console.log(`   ${emoji} ${row.severity.padEnd(10)}: ${row.pending_count} pending`);
    }
  }

  console.log();

  // Snoozed section
  console.log(`😴 Snoozed (waiting reply): ${snoozed.count}`);

  console.log();

  // Done section
  const doneCount = resolved.count + outdated.count;
  console.log(`✅ Done: ${doneCount} (Resolved: ${resolved.count}, Outdated: ${outdated.count})`);
  for (const row of bySeverityAll) {
    if (row.resolved_count > 0 || row.outdated_count > 0) {
      const emoji = severityEmoji[row.severity] || "⚪";
      console.log(
        `   ${emoji} ${row.severity.padEnd(10)}: ${row.resolved_count} resolved, ${row.outdated_count} outdated`,
      );
    }
  }

  console.log();
}

// Show help
function showHelp(): void {
  console.log(`
📝 discuss.ts - PR Review Comment Manager

USAGE:
  bun discuss.ts <command> [options]

COMMANDS:
  fetch [pr-number]              Fetch comments from GitHub PR (default: ${DEFAULT_PR})
  list [--priority X]            List all comments, optionally filtered by severity
  search <query> [--show-resolved]  Search comments by text (body or path)
  show <id>...                   Show full details of one or more comments
  note <id> <text>               Add a note/memory to a comment
  reply <id> <text>              Reply to a comment on GitHub, auto-snooze, and refresh
  snooze <id>                    Mark comment as waiting for reply (snoozed)
  unsnooze <id>                  Unmark comment as waiting for reply
  unsnooze-all                   Clear all snoozed statuses at once
  resolve <id>... [commit] [--commit <hash>] [--reply <msg>]
                                 Resolve one or more comments on GitHub
  unresolve <id>                 Unresolve comment on GitHub
  pending [--priority X | --severity X] [--snoozed]
                                 Show unresolved comments (excludes snoozed by default)
  stats                          Show summary statistics
  help                           Show this help message

EXAMPLES:
  bun discuss.ts fetch
  bun discuss.ts fetch 23798
  bun discuss.ts list
  bun discuss.ts list --priority critical
  bun discuss.ts search "cleanup active spans"
  bun discuss.ts search "cleanup" --show-resolved
  bun discuss.ts pending
  bun discuss.ts pending --snoozed          # Also show snoozed comments
  bun discuss.ts pending --priority critical # Show only critical severity
  bun discuss.ts pending --severity major   # Alternative syntax
  bun discuss.ts show 2442564379
  bun discuss.ts show 2442564379 2442763847     # Show multiple comments
  bun discuss.ts note 2442564379 "Fixed in telemetry.zig"
  bun discuss.ts reply 2442564379 "This is incorrect - .null is the correct sentinel"
  bun discuss.ts resolve 2442564379 abc123
  bun discuss.ts resolve 2442564379 2442763847     # Resolve multiple IDs
  bun discuss.ts resolve 2442564379 --commit HEAD --reply "Fixed by refactoring the API"
  bun discuss.ts unresolve 2442564379
  bun discuss.ts stats

INTEGRATION:
  - Resolution status synced with GitHub (resolving/unresolving updates GitHub)
  - Thread resolution state is fetched from GitHub on every fetch
  - GitHub is the source of truth for resolution status

DATA:
  Comments are stored in ${DB_PATH}
  Each comment tracks: priority, severity, GitHub resolution status, commits, and notes
`);
}

// Main CLI handler
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }

  const command = args[0];

  switch (command) {
    case "fetch":
      await fetchComments(args[1] || DEFAULT_PR);
      break;

    case "list": {
      const priorityIdx = args.indexOf("--priority");
      const priority = priorityIdx >= 0 ? args[priorityIdx + 1] : undefined;
      listComments(priority);
      break;
    }

    case "search": {
      if (!args[1]) {
        console.error("❌ Usage: bun discuss.ts search <query> [--show-resolved]");
        process.exit(1);
      }
      const showResolved = args.includes("--show-resolved");
      const query = args[1];
      searchComments(query, showResolved);
      break;
    }

    case "show": {
      if (!args[1]) {
        console.error("❌ Usage: bun discuss.ts show <id>...");
        process.exit(1);
      }

      // Collect all valid IDs
      const ids: string[] = [];
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const existsInDb = db.query("SELECT 1 FROM comments WHERE id = ?").get(parseInt(arg)) !== null;
        if (existsInDb) {
          ids.push(arg);
        } else {
          console.warn(`⚠️  Skipping invalid ID: ${arg}`);
        }
      }

      if (ids.length === 0) {
        console.error("❌ No valid comment IDs provided");
        process.exit(1);
      }

      // Show header if multiple IDs
      if (ids.length > 1) {
        console.log(`\n📋 Showing ${ids.length} comments: ${ids.join(", ")}`);
        console.log("─".repeat(80));
      }

      // Display each comment
      for (let i = 0; i < ids.length; i++) {
        showComment(ids[i]);

        // Add separator between comments (but not after the last one)
        if (i < ids.length - 1) {
          console.log("─".repeat(80));
        }
      }
      break;
    }

    case "note":
      if (!args[1] || !args[2]) {
        console.error("❌ Usage: bun discuss.ts note <id> <text>");
        process.exit(1);
      }
      addNote(args[1], args.slice(2).join(" "));
      break;

    case "reply":
      if (!args[1] || !args[2]) {
        console.error("❌ Usage: bun discuss.ts reply <id> <text>");
        process.exit(1);
      }
      await replyToComment(args[1], args.slice(2).join(" "));
      break;

    case "snooze":
      if (!args[1]) {
        console.error("❌ Usage: bun discuss.ts snooze <id>");
        process.exit(1);
      }
      snoozeComment(args[1]);
      break;

    case "unsnooze":
      if (!args[1]) {
        console.error("❌ Usage: bun discuss.ts unsnooze <id>");
        process.exit(1);
      }
      unsnoozeComment(args[1]);
      break;

    case "unsnooze-all":
      unsnoozeAll();
      break;

    case "resolve": {
      if (!args[1]) {
        console.error("❌ Usage: bun discuss.ts resolve <id>... [commit] [--commit <hash>] [--reply <message>]");
        process.exit(1);
      }

      // Parse flags
      const replyIndex = args.indexOf("--reply");
      const replyMessage = replyIndex !== -1 ? args[replyIndex + 1] : undefined;

      const commitFlagIndex = args.indexOf("--commit");
      let commitHash: string | undefined = commitFlagIndex !== -1 ? args[commitFlagIndex + 1] : undefined;

      // Collect IDs and find commit hash
      const ids: string[] = [];

      // Check all positional arguments (skip flags)
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];

        // Skip flag names and their values
        if (arg === "--reply" || arg === "--commit") {
          i++; // Skip the next arg (flag value)
          continue;
        }
        if (args[i - 1] === "--reply" || args[i - 1] === "--commit") {
          continue; // This is a flag value
        }

        // Check if this arg is an ID in the database
        const existsInDb = db.query("SELECT 1 FROM comments WHERE id = ?").get(parseInt(arg)) !== null;

        if (existsInDb) {
          ids.push(arg);
        } else if (!commitHash) {
          // Not in DB and we don't have a commit yet - treat as commit
          commitHash = arg;
        }
      }

      if (ids.length === 0) {
        console.error("❌ No valid comment IDs provided");
        process.exit(1);
      }

      // Resolve all collected IDs
      for (const id of ids) {
        await resolveComment(id, commitHash, replyMessage);
        if (ids.length > 1) {
          console.log(); // Spacing between multiple resolves
        }
      }
      break;
    }

    case "unresolve":
      if (!args[1]) {
        console.error("❌ Usage: bun discuss.ts unresolve <id>");
        process.exit(1);
      }
      await unresolveComment(args[1]);
      break;

    case "pending": {
      const showSnoozed = args.includes("--snoozed");

      // Parse severity filter (support both --priority and --severity)
      const priorityIndex = args.indexOf("--priority");
      const severityIndex = args.indexOf("--severity");
      let severityFilter: string | undefined;

      if (priorityIndex >= 0 && args[priorityIndex + 1]) {
        severityFilter = args[priorityIndex + 1];
      } else if (severityIndex >= 0 && args[severityIndex + 1]) {
        severityFilter = args[severityIndex + 1];
      }

      showPending(severityFilter, showSnoozed);
      break;
    }

    case "stats":
      showStats();
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log('   Run "bun discuss.ts help" for usage information');
      process.exit(1);
  }
}

// Run!
main().catch(error => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
