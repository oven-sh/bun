#!/usr/bin/env bun
/**
 * Fetch all open GitHub issues for oven-sh/bun into a SQLite database.
 *
 *   bun scripts/fetch-issues-to-sqlite.ts [db-path] [--with-comments]
 *
 * Schema:
 *   issues(id PK, number, title, body, state, created_at, updated_at, closed_at,
 *          author, comments_count, reactions_total, html_url, is_pull_request,
 *          labels_json)       -- labels as JSON array of {name,color}
 *   labels(issue_id, name)    -- denormalized for `WHERE name = 'crash'` queries
 *   comments(id PK, issue_id, author, body, created_at, html_url)
 *
 * Uses `gh api --paginate` so it respects whatever auth `gh` already has.
 * GraphQL would be fewer round-trips but the REST list endpoint with
 * `--paginate` is one shell call and gh handles Link headers + retries.
 */

import { $ } from "bun";
import { Database } from "bun:sqlite";

const DB_PATH = Bun.argv[2] ?? "tmp/bun-issues.sqlite";
const WITH_COMMENTS = Bun.argv.includes("--with-comments");
const REPO = "oven-sh/bun";

console.error(`→ ${DB_PATH} (comments: ${WITH_COMMENTS})`);

const db = new Database(DB_PATH, { create: true });
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY,
    number INTEGER UNIQUE NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT,
    author TEXT,
    comments_count INTEGER NOT NULL DEFAULT 0,
    reactions_total INTEGER NOT NULL DEFAULT 0,
    html_url TEXT NOT NULL,
    is_pull_request INTEGER NOT NULL DEFAULT 0,
    labels_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS labels (
    issue_id INTEGER NOT NULL REFERENCES issues(id),
    name TEXT NOT NULL,
    PRIMARY KEY (issue_id, name)
  );
  CREATE INDEX IF NOT EXISTS labels_name ON labels(name);
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    issue_id INTEGER NOT NULL REFERENCES issues(id),
    author TEXT,
    body TEXT,
    created_at TEXT NOT NULL,
    html_url TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS comments_issue ON comments(issue_id);
  -- Full-text search over title+body for the leak/crash classifier.
  CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts USING fts5(
    title, body, content='issues', content_rowid='id'
  );
`);

const insIssue = db.prepare(
  `INSERT OR REPLACE INTO issues
   (id, number, title, body, state, created_at, updated_at, closed_at, author,
    comments_count, reactions_total, html_url, is_pull_request, labels_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insLabel = db.prepare(`INSERT OR IGNORE INTO labels (issue_id, name) VALUES (?, ?)`);
const insFts = db.prepare(`INSERT OR REPLACE INTO issues_fts (rowid, title, body) VALUES (?, ?, ?)`);
const insComment = db.prepare(
  `INSERT OR REPLACE INTO comments (id, issue_id, author, body, created_at, html_url)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

// ─── Fetch issues ────────────────────────────────────────────────────────────
// `gh api --paginate` follows Link: rel=next automatically and concatenates
// page arrays with --slurp into a single top-level array. ~68 pages × 100.
console.error(`fetching issues (paginated, ~68 pages)...`);
const raw =
  await $`gh api 'repos/${REPO}/issues?state=open&per_page=100&sort=created&direction=asc' --paginate --slurp`.text();
// --slurp gives [[page1...], [page2...], ...]; flatten.
type GhIssue = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  user: { login: string } | null;
  comments: number;
  reactions?: { total_count: number };
  html_url: string;
  pull_request?: unknown;
  labels: Array<{ name: string; color: string }>;
};
const pages: GhIssue[][] = JSON.parse(raw);
const issues: GhIssue[] = pages.flat();
console.error(`fetched ${issues.length} issues (incl. PRs)`);

db.exec("BEGIN");
let nIssues = 0;
for (const it of issues) {
  const isPR = it.pull_request != null ? 1 : 0;
  insIssue.run(
    it.id,
    it.number,
    it.title,
    it.body ?? "",
    it.state,
    it.created_at,
    it.updated_at,
    it.closed_at,
    it.user?.login ?? null,
    it.comments,
    it.reactions?.total_count ?? 0,
    it.html_url,
    isPR,
    JSON.stringify(it.labels.map(l => ({ name: l.name, color: l.color }))),
  );
  for (const l of it.labels) insLabel.run(it.id, l.name);
  insFts.run(it.id, it.title, it.body ?? "");
  if (!isPR) nIssues++;
}
db.exec("COMMIT");
console.error(`stored ${nIssues} issues + ${issues.length - nIssues} PRs`);

// ─── Fetch comments (optional, slow: 1 request per issue with comments>0) ───
if (WITH_COMMENTS) {
  const withComments = issues.filter(i => i.comments > 0 && i.pull_request == null);
  console.error(`fetching comments for ${withComments.length} issues...`);
  let done = 0;
  // Limit concurrency so gh's secondary-rate-limit retry handles bursts.
  const CONC = 8;
  for (let i = 0; i < withComments.length; i += CONC) {
    const batch = withComments.slice(i, i + CONC);
    const results = await Promise.all(
      batch.map(async it => {
        try {
          const txt =
            await $`gh api 'repos/${REPO}/issues/${it.number}/comments?per_page=100' --paginate --slurp`.text();
          const cs = (
            JSON.parse(txt) as Array<
              Array<{ id: number; user: { login: string } | null; body: string; created_at: string; html_url: string }>
            >
          ).flat();
          return { issue: it, cs };
        } catch (e) {
          console.error(`  #${it.number}: ${(e as Error).message}`);
          return { issue: it, cs: [] };
        }
      }),
    );
    db.exec("BEGIN");
    for (const { issue, cs } of results) {
      for (const c of cs) {
        insComment.run(c.id, issue.id, c.user?.login ?? null, c.body, c.created_at, c.html_url);
      }
    }
    db.exec("COMMIT");
    done += batch.length;
    if (done % 200 === 0) console.error(`  ${done}/${withComments.length}`);
  }
}

// ─── Summary ────────────────────────────────────────────────────────────────
const summary = db.query<{ n: number }, []>(`SELECT count(*) AS n FROM issues WHERE is_pull_request = 0`).get()!;
const labelCounts = db
  .query<{ name: string; n: number }, []>(
    `SELECT name, count(*) AS n FROM labels
     JOIN issues ON issues.id = labels.issue_id
     WHERE is_pull_request = 0
     GROUP BY name ORDER BY n DESC LIMIT 20`,
  )
  .all();
console.error(`\n${summary.n} open issues. Top labels:`);
for (const l of labelCounts) console.error(`  ${l.n.toString().padStart(5)}  ${l.name}`);

// Crash/leak heuristic preview
const crashLeak = db
  .query<{ n: number }, []>(
    `SELECT count(DISTINCT i.id) AS n FROM issues i
     LEFT JOIN labels l ON l.issue_id = i.id
     WHERE i.is_pull_request = 0 AND (
       l.name IN ('crash', 'memory leak', 'segfault', 'panic')
       OR i.id IN (SELECT rowid FROM issues_fts WHERE issues_fts MATCH
         '"memory leak" OR segfault OR SIGSEGV OR SIGABRT OR "heap-use-after-free" OR "double free" OR panic OR crash OR "out of memory" OR "leaked memory"')
     )`,
  )
  .get()!;
console.error(`\n~${crashLeak.n} issues match crash/leak heuristic (label or FTS).`);
console.error(`\nQuery with: sqlite3 ${DB_PATH}`);
