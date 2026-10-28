import { sql } from "../database";
import type { Issue, IssueState, Project, Session } from "../types";

export interface IssueFields {
  title: string;
  body: string;
  priority: number;
  labels: string[];
  assigneeId: number | null;
}

/** Makes the issue and says which number it got. `flash` is shown to the author on the next page. */
export async function insertIssue(project: Project, session: Session, fields: IssueFields, flash: string | null): Promise<number> {
  return await sql.begin(async tx => {
    const [taken] = await tx<{ number: number }[]>`
      UPDATE projects SET next_number = next_number + 1, open_issues = open_issues + 1
      WHERE id = ${project.id}
      RETURNING next_number - 1 AS number`;
    if (!taken) throw new Error(`There is no project ${project.id}`);
    const [issue] = await tx<{ id: number }[]>`
      INSERT INTO issues (project_id, number, author_id, assignee_id, title, body, state, priority, comment_count, created_at, updated_at)
      VALUES (${project.id}, ${taken.number}, ${session.user.id}, ${fields.assigneeId}, ${fields.title}, ${fields.body}, 'open', ${fields.priority}, 0, now(), now())
      RETURNING id`;
    if (!issue) throw new Error("The issue was not made");
    if (fields.labels.length > 0) {
      await tx`
        INSERT INTO issue_labels (issue_id, label_id)
        SELECT ${issue.id}, id FROM labels WHERE project_id = ${project.id} AND name = ANY(${sql.array(fields.labels, "TEXT")})`;
      await tx`UPDATE labels SET open_issues = open_issues + 1 WHERE project_id = ${project.id} AND name = ANY(${sql.array(fields.labels, "TEXT")})`;
    }
    if (flash !== null) await tx`UPDATE sessions SET flash = ${flash} WHERE token = ${session.token}`;
    return taken.number;
  });
}

export async function updateIssue(
  project: Project,
  issue: Issue,
  session: Session,
  fields: IssueFields,
  state: IssueState,
  flash: string | null,
): Promise<void> {
  await sql.begin(async tx => {
    await tx`
      UPDATE issues
      SET title = ${fields.title}, body = ${fields.body}, priority = ${fields.priority}, assignee_id = ${fields.assigneeId}, state = ${state},
          closed_at = CASE WHEN ${state} = 'closed' THEN coalesce(closed_at, now()) END, updated_at = now()
      WHERE id = ${issue.id}`;
    if (state !== issue.state) {
      const opened = state === "open" ? 1 : -1;
      await tx`UPDATE projects SET open_issues = open_issues + ${opened}, closed_issues = closed_issues - ${opened} WHERE id = ${project.id}`;
    }
    await tx`DELETE FROM issue_labels WHERE issue_id = ${issue.id}`;
    if (fields.labels.length > 0) {
      await tx`
        INSERT INTO issue_labels (issue_id, label_id)
        SELECT ${issue.id}, id FROM labels WHERE project_id = ${project.id} AND name = ANY(${sql.array(fields.labels, "TEXT")})`;
    }
    await tx`
      UPDATE labels l
      SET open_issues = (SELECT count(*) FROM issue_labels il JOIN issues i ON i.id = il.issue_id WHERE il.label_id = l.id AND i.state = 'open')
      WHERE l.project_id = ${project.id}`;
    if (flash !== null) await tx`UPDATE sessions SET flash = ${flash} WHERE token = ${session.token}`;
  });
}

export async function commentBelongsTo(commentId: number, issueId: number): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM comments WHERE id = ${commentId} AND issue_id = ${issueId}`;
  return rows.length > 0;
}

export async function insertComment(
  issue: Issue,
  session: Session,
  body: string,
  parentId: number | null,
  flash: string | null,
): Promise<{ id: number; createdAt: Date }> {
  return await sql.begin(async tx => {
    const [comment] = await tx<{ id: number; createdAt: Date }[]>`
      INSERT INTO comments (issue_id, parent_id, author_id, body, created_at)
      VALUES (${issue.id}, ${parentId}, ${session.user.id}, ${body}, now())
      RETURNING id, created_at AS "createdAt"`;
    if (!comment) throw new Error("The comment was not made");
    await tx`UPDATE issues SET comment_count = comment_count + 1, updated_at = now() WHERE id = ${issue.id}`;
    if (flash !== null) await tx`UPDATE sessions SET flash = ${flash} WHERE token = ${session.token}`;
    return comment;
  });
}
