import { sql } from "../database";
import type { IssueMention, IssueState, Label, ProjectSummary } from "../types";

export interface IssueMentionRow {
  projectSlug: string;
  projectName: string;
  number: number;
  title: string;
  state: IssueState;
  createdAt: Date;
  authorLogin: string;
  authorName: string;
}

export function mentionOf(row: IssueMentionRow): IssueMention {
  return {
    project: { slug: row.projectSlug, name: row.projectName },
    number: row.number,
    title: row.title,
    state: row.state,
    createdAt: row.createdAt,
    author: { login: row.authorLogin, name: row.authorName },
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return await sql<ProjectSummary[]>`
    SELECT id, slug, name, description, open_issues AS "openIssues", closed_issues AS "closedIssues"
    FROM projects
    ORDER BY open_issues DESC, id`;
}

export async function newestIssues(limit: number): Promise<IssueMention[]> {
  const rows = await sql<IssueMentionRow[]>`
    SELECT p.slug AS "projectSlug", p.name AS "projectName", i.number, i.title, i.state, i.created_at AS "createdAt",
           a.login AS "authorLogin", a.name AS "authorName"
    FROM issues i JOIN projects p ON p.id = i.project_id JOIN users a ON a.id = i.author_id
    ORDER BY i.created_at DESC
    LIMIT ${limit}`;
  return rows.map(mentionOf);
}

export async function labelsOfProject(projectId: number): Promise<Label[]> {
  return await sql<Label[]>`SELECT id, name, color FROM labels WHERE project_id = ${projectId} ORDER BY name`;
}
