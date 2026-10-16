import { sql } from "../database";
import type { AdminStats } from "../types";

export async function adminStats(): Promise<AdminStats> {
  const [totals, months, priorities, commenters, busiest] = await Promise.all([
    sql<AdminStats["totals"][]>`
      SELECT (SELECT count(*) FROM users)::int AS users,
             (SELECT count(*) FROM projects)::int AS projects,
             (SELECT sum(open_issues) FROM projects)::int AS "openIssues",
             (SELECT sum(closed_issues) FROM projects)::int AS "closedIssues",
             (SELECT count(*) FROM comments)::int AS comments`,
    sql<AdminStats["months"]>`
      SELECT to_char(month, 'YYYY-MM') AS month,
             (SELECT count(*) FROM issues WHERE created_at >= month AND created_at < month + interval '1 month')::int AS opened,
             (SELECT count(*) FROM issues WHERE closed_at >= month AND closed_at < month + interval '1 month')::int AS closed
      FROM generate_series(timestamptz '2025-06-01 00:00:00+00', timestamptz '2026-05-01 00:00:00+00', interval '1 month') AS month
      ORDER BY month`,
    sql<AdminStats["priorities"]>`
      SELECT priority,
             count(*) FILTER (WHERE state = 'open')::int AS open,
             coalesce(round(extract(epoch FROM avg(closed_at - created_at)) / 60), 0)::int AS "minutesToClose"
      FROM issues
      GROUP BY priority
      ORDER BY priority DESC`,
    sql<AdminStats["commenters"]>`
      SELECT u.login, u.name, busy.comments
      FROM (SELECT author_id, count(*)::int AS comments FROM comments GROUP BY author_id ORDER BY comments DESC, author_id LIMIT 10) AS busy
      JOIN users u ON u.id = busy.author_id
      ORDER BY busy.comments DESC, u.id`,
    sql<AdminStats["busiest"]>`
      SELECT p.slug, p.name, sum(i.comment_count)::int AS comments
      FROM projects p JOIN issues i ON i.project_id = p.id
      GROUP BY p.id
      ORDER BY comments DESC, p.id
      LIMIT 10`,
  ]);
  return { totals: totals[0] ?? { users: 0, projects: 0, openIssues: 0, closedIssues: 0, comments: 0 }, months, priorities, commenters, busiest };
}
