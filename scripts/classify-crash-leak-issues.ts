#!/usr/bin/env bun
/**
 * Dump crash/leak-candidate issues from the SQLite DB into per-issue JSON
 * files for the classifier workflow to consume (workflows can't read SQLite
 * directly — agents read flat files).
 *
 *   bun scripts/classify-crash-leak-issues.ts [db-path] [out-dir]
 *
 * Output: <out-dir>/<number>.json with {number,title,body,labels,comments[],
 * created_at,html_url}. Also writes <out-dir>/index.json = [{number,title}].
 */

import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";

const DB = Bun.argv[2] ?? "tmp/bun-issues.sqlite";
const OUT = Bun.argv[3] ?? "tmp/crash-leak-issues";
mkdirSync(OUT, { recursive: true });

const db = new Database(DB, { readonly: true });

// Broad net: label OR FTS body match. The classifier agents narrow it down.
const issues = db
  .query<
    {
      id: number;
      number: number;
      title: string;
      body: string;
      created_at: string;
      html_url: string;
      labels_json: string;
    },
    []
  >(
    `SELECT DISTINCT i.id, i.number, i.title, i.body, i.created_at, i.html_url, i.labels_json
     FROM issues i
     LEFT JOIN labels l ON l.issue_id = i.id
     WHERE i.is_pull_request = 0 AND (
       l.name IN ('crash', 'memory leak', 'segfault', 'panic')
       OR i.id IN (SELECT rowid FROM issues_fts WHERE issues_fts MATCH
         '"memory leak" OR segfault OR SIGSEGV OR SIGABRT OR SIGBUS OR SIGILL OR
          "heap-use-after-free" OR "use-after-free" OR "double free" OR "use after free" OR
          panic OR crash OR crashed OR crashes OR
          "out of memory" OR OOM OR "leaked memory" OR "memory grows" OR "RSS grows" OR
          "bun has crashed" OR "Segmentation fault" OR "Illegal instruction" OR
          "AddressSanitizer" OR "LeakSanitizer" OR "stack-buffer-overflow" OR
          "heap-buffer-overflow"')
     )
     ORDER BY i.number`,
  )
  .all();

const getComments = db.prepare<{ author: string; body: string; created_at: string }, [number]>(
  `SELECT author, body, created_at FROM comments WHERE issue_id = ? ORDER BY created_at`,
);

const index: Array<{ number: number; title: string; path: string }> = [];
for (const i of issues) {
  const comments = getComments.all(i.id);
  const labels = (JSON.parse(i.labels_json) as Array<{ name: string }>).map(l => l.name);
  const out = {
    number: i.number,
    title: i.title,
    body: i.body,
    labels,
    created_at: i.created_at,
    html_url: i.html_url,
    comments: comments.map(c => ({ author: c.author, body: c.body, at: c.created_at })),
  };
  const p = `${OUT}/${i.number}.json`;
  writeFileSync(p, JSON.stringify(out, null, 2));
  index.push({ number: i.number, title: i.title, path: p });
}
writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 2));
console.error(`wrote ${issues.length} candidate issues → ${OUT}/`);
