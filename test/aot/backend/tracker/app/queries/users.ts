import { sql } from "../database";
import type { CommentMention, IssueMention, User } from "../types";
import { mentionOf, type IssueMentionRow } from "./projects";

interface CommentMentionRow {
  id: number;
  projectSlug: string;
  projectName: string;
  issueNumber: number;
  issueTitle: string;
  body: string;
  createdAt: Date;
}

export interface Password {
  userId: number;
  salt: string;
  hash: string;
}

export async function findUser(login: string): Promise<User | null> {
  const [user] = await sql<User[]>`SELECT id, login, name, bio, role, created_at AS "createdAt" FROM users WHERE login = ${login}`;
  return user ?? null;
}

export async function findUserId(login: string): Promise<number | null> {
  const [user] = await sql<{ id: number }[]>`SELECT id FROM users WHERE login = ${login}`;
  return user?.id ?? null;
}

export async function findPassword(login: string): Promise<Password | null> {
  const [password] = await sql<Password[]>`
    SELECT id AS "userId", password_salt AS salt, password_hash AS hash FROM users WHERE login = ${login}`;
  return password ?? null;
}

export async function countWritten(userId: number): Promise<{ issues: number; comments: number }> {
  const [counts] = await sql<{ issues: number; comments: number }[]>`
    SELECT (SELECT count(*) FROM issues WHERE author_id = ${userId})::int AS issues,
           (SELECT count(*) FROM comments WHERE author_id = ${userId})::int AS comments`;
  return counts ?? { issues: 0, comments: 0 };
}

export async function issuesBy(userId: number, limit: number): Promise<IssueMention[]> {
  const rows = await sql<IssueMentionRow[]>`
    SELECT p.slug AS "projectSlug", p.name AS "projectName", i.number, i.title, i.state, i.created_at AS "createdAt",
           a.login AS "authorLogin", a.name AS "authorName"
    FROM issues i JOIN projects p ON p.id = i.project_id JOIN users a ON a.id = i.author_id
    WHERE i.author_id = ${userId}
    ORDER BY i.created_at DESC
    LIMIT ${limit}`;
  return rows.map(mentionOf);
}

export async function commentsBy(userId: number, limit: number): Promise<CommentMention[]> {
  const rows = await sql<CommentMentionRow[]>`
    SELECT c.id, p.slug AS "projectSlug", p.name AS "projectName", i.number AS "issueNumber", i.title AS "issueTitle",
           c.body, c.created_at AS "createdAt"
    FROM comments c JOIN issues i ON i.id = c.issue_id JOIN projects p ON p.id = i.project_id
    WHERE c.author_id = ${userId}
    ORDER BY c.created_at DESC
    LIMIT ${limit}`;
  return rows.map(row => ({
    id: row.id,
    project: { slug: row.projectSlug, name: row.projectName },
    issue: { number: row.issueNumber, title: row.issueTitle },
    body: row.body,
    createdAt: row.createdAt,
  }));
}
