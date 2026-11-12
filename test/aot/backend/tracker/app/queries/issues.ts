import { sql } from "../database";
import type { IssueFilters } from "../filters";
import type { Comment, Issue, IssueState, IssueSummary, Label, LabelCount, Project, StateCounts } from "../types";

interface IssueSummaryRow {
  id: number;
  number: number;
  title: string;
  state: IssueState;
  priority: number;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
  authorLogin: string;
  authorName: string;
  assigneeLogin: string | null;
  assigneeName: string | null;
}

interface IssueRow extends IssueSummaryRow {
  body: string;
  closedAt: Date | null;
  projectId: number;
  projectSlug: string;
  projectName: string;
  projectDescription: string;
}

interface IssueLabelRow extends Label {
  issueId: number;
}

interface CommentRow {
  id: number;
  parentId: number | null;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  authorLogin: string;
  authorName: string;
}

function summaryOf(row: IssueSummaryRow, labels: Label[]): IssueSummary {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    state: row.state,
    priority: row.priority,
    commentCount: row.commentCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: { login: row.authorLogin, name: row.authorName },
    assignee: row.assigneeLogin === null || row.assigneeName === null ? null : { login: row.assigneeLogin, name: row.assigneeName },
    labels,
  };
}

export async function findProject(slug: string): Promise<Project | null> {
  const [project] = await sql<Project[]>`SELECT id, slug, name, description FROM projects WHERE slug = ${slug}`;
  return project ?? null;
}

function withLabel(label: string | null) {
  return label === null
    ? sql``
    : sql`AND EXISTS (SELECT 1 FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = i.id AND l.name = ${label})`;
}

export async function listIssues(projectId: number, filters: IssueFilters): Promise<IssueSummary[]> {
  const order = {
    updated: sql`i.updated_at DESC`,
    created: sql`i.created_at DESC`,
    comments: sql`i.comment_count DESC`,
  }[filters.sort];
  const rows = await sql<IssueSummaryRow[]>`
    SELECT i.id, i.number, i.title, i.state, i.priority, i.comment_count AS "commentCount",
           i.created_at AS "createdAt", i.updated_at AS "updatedAt",
           a.login AS "authorLogin", a.name AS "authorName", s.login AS "assigneeLogin", s.name AS "assigneeName"
    FROM (
      SELECT i.id FROM issues i
      WHERE i.project_id = ${projectId} AND i.state = ${filters.state} ${withLabel(filters.label)}
      ORDER BY ${order}, i.id DESC
      LIMIT ${filters.perPage} OFFSET ${(filters.page - 1) * filters.perPage}
    ) AS page
    JOIN issues i ON i.id = page.id JOIN users a ON a.id = i.author_id LEFT JOIN users s ON s.id = i.assignee_id
    ORDER BY ${order}, i.id DESC`;
  if (rows.length === 0) return [];

  const labelRows = await sql<IssueLabelRow[]>`
    SELECT il.issue_id AS "issueId", l.id, l.name, l.color
    FROM issue_labels il JOIN labels l ON l.id = il.label_id
    WHERE il.issue_id = ANY(${sql.array(
      rows.map(row => row.id),
      "INT4",
    )})
    ORDER BY l.name`;
  const labelsOfIssue = new Map<number, Label[]>();
  for (const { issueId, id, name, color } of labelRows) {
    const labels = labelsOfIssue.get(issueId);
    if (labels) labels.push({ id, name, color });
    else labelsOfIssue.set(issueId, [{ id, name, color }]);
  }
  return rows.map(row => summaryOf(row, labelsOfIssue.get(row.id) ?? []));
}

export async function countByState(projectId: number, label: string | null): Promise<StateCounts> {
  const [counts] =
    label === null
      ? await sql<StateCounts[]>`SELECT open_issues AS open, closed_issues AS closed FROM projects WHERE id = ${projectId}`
      : await sql<StateCounts[]>`
          SELECT count(*) FILTER (WHERE i.state = 'open')::int AS open, count(*) FILTER (WHERE i.state = 'closed')::int AS closed
          FROM labels l JOIN issue_labels il ON il.label_id = l.id JOIN issues i ON i.id = il.issue_id
          WHERE l.project_id = ${projectId} AND l.name = ${label}`;
  return counts ?? { open: 0, closed: 0 };
}

export async function countByLabel(projectId: number): Promise<LabelCount[]> {
  return await sql<LabelCount[]>`
    SELECT id, name, color, open_issues AS "openIssues" FROM labels WHERE project_id = ${projectId} ORDER BY name`;
}

export async function findIssue(projectSlug: string, number: number): Promise<{ project: Project; issue: Issue } | null> {
  const [row] = await sql<IssueRow[]>`
    SELECT i.id, i.number, i.title, i.state, i.priority, i.comment_count AS "commentCount",
           i.created_at AS "createdAt", i.updated_at AS "updatedAt",
           a.login AS "authorLogin", a.name AS "authorName", s.login AS "assigneeLogin", s.name AS "assigneeName",
           i.body, i.closed_at AS "closedAt",
           p.id AS "projectId", p.slug AS "projectSlug", p.name AS "projectName", p.description AS "projectDescription"
    FROM projects p JOIN issues i ON i.project_id = p.id
    JOIN users a ON a.id = i.author_id LEFT JOIN users s ON s.id = i.assignee_id
    WHERE p.slug = ${projectSlug} AND i.number = ${number}`;
  if (!row) return null;
  return {
    project: { id: row.projectId, slug: row.projectSlug, name: row.projectName, description: row.projectDescription },
    issue: { ...summaryOf(row, []), body: row.body, closedAt: row.closedAt },
  };
}

export async function labelsOf(issueId: number): Promise<Label[]> {
  return await sql<Label[]>`
    SELECT l.id, l.name, l.color
    FROM issue_labels il JOIN labels l ON l.id = il.label_id
    WHERE il.issue_id = ${issueId}
    ORDER BY l.name`;
}

export async function commentsOf(issueId: number): Promise<Comment[]> {
  const rows = await sql<CommentRow[]>`
    SELECT c.id, c.parent_id AS "parentId", c.body, c.created_at AS "createdAt", c.edited_at AS "editedAt",
           u.login AS "authorLogin", u.name AS "authorName"
    FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.issue_id = ${issueId}
    ORDER BY c.id`;
  return rows.map(row => ({
    id: row.id,
    parentId: row.parentId,
    author: { login: row.authorLogin, name: row.authorName },
    body: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
  }));
}
