import { sql } from "../database";
import type { SearchHit } from "../types";
import { mentionOf, type IssueMentionRow } from "./projects";

interface SearchRow extends IssueMentionRow {
  body: string;
  commentCount: number;
}

export async function searchIssues(text: string, limit: number, offset: number): Promise<SearchHit[]> {
  const rows = await sql<SearchRow[]>`
    SELECT p.slug AS "projectSlug", p.name AS "projectName", i.number, i.title, i.state, i.created_at AS "createdAt",
           a.login AS "authorLogin", a.name AS "authorName", i.body, i.comment_count AS "commentCount"
    FROM issues i JOIN projects p ON p.id = i.project_id JOIN users a ON a.id = i.author_id
    WHERE i.search @@ websearch_to_tsquery('english', ${text})
    ORDER BY ts_rank(i.search, websearch_to_tsquery('english', ${text})) DESC, i.id DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return rows.map(row => ({ ...mentionOf(row), body: row.body, commentCount: row.commentCount }));
}

export async function countHits(text: string): Promise<number> {
  const [row] = await sql<{ hits: number }[]>`
    SELECT count(*)::int AS hits FROM issues i WHERE i.search @@ websearch_to_tsquery('english', ${text})`;
  return row?.hits ?? 0;
}
