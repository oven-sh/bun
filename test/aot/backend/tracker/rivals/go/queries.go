package main

import (
	"time"

	"github.com/jackc/pgx/v5"
)

// Every function here puts one query into a batch. The queries of a batch go to the server together, on one connection, and the
// function given to Query or QueryRow reads the answer when the batch is closed.

const summaryColumns = `i.id, i.number, i.title, i.state, i.priority, i.comment_count,
       i.created_at, i.updated_at, a.login, a.name, s.login, s.name`

const withLabel = ` AND EXISTS (SELECT 1 FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = i.id AND l.name = $3)`

func summaryFields(row *issueSummary, assigneeLogin, assigneeName **string) []any {
	return []any{&row.ID, &row.Number, &row.Title, &row.State, &row.Priority, &row.CommentCount, (*time.Time)(&row.CreatedAt), (*time.Time)(&row.UpdatedAt),
		&row.Author.Login, &row.Author.Name, assigneeLogin, assigneeName}
}

func assigneeOf(login, name *string) *userRef {
	if login == nil || name == nil {
		return nil
	}
	return &userRef{Login: *login, Name: *name}
}

func ignoreNoRows(err error) error {
	if err == pgx.ErrNoRows {
		return nil
	}
	return err
}

func queueSession(batch *pgx.Batch, token string, found **session) {
	batch.Queue(`SELECT s.token, s.csrf_token, s.flash, u.id, u.login, u.name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > now()`, token).QueryRow(func(row pgx.Row) error {
		var s session
		if err := row.Scan(&s.Token, &s.CSRFToken, &s.Flash, &s.User.ID, &s.User.Login, &s.User.Name, &s.User.Role); err != nil {
			return ignoreNoRows(err)
		}
		*found = &s
		return nil
	})
}

func queueProject(batch *pgx.Batch, slug string, found **project) {
	batch.Queue(`SELECT id, slug, name, description FROM projects WHERE slug = $1`, slug).QueryRow(func(row pgx.Row) error {
		var p project
		if err := row.Scan(&p.ID, &p.Slug, &p.Name, &p.Description); err != nil {
			return ignoreNoRows(err)
		}
		*found = &p
		return nil
	})
}

func queueIssues(batch *pgx.Batch, projectID int32, filters issueFilters, issues *[]issueSummary) {
	query := `SELECT ` + summaryColumns + `
    FROM (
      SELECT i.id FROM issues i
      WHERE i.project_id = $1 AND i.state = $2`
	arguments := []any{projectID, filters.State}
	limit := ` LIMIT $3 OFFSET $4`
	if filters.Label != nil {
		query += withLabel
		arguments = append(arguments, *filters.Label)
		limit = ` LIMIT $4 OFFSET $5`
	}
	order := ` ORDER BY i.updated_at DESC, i.id DESC`
	switch filters.Sort {
	case "created":
		order = ` ORDER BY i.created_at DESC, i.id DESC`
	case "comments":
		order = ` ORDER BY i.comment_count DESC, i.id DESC`
	}
	query += order + limit + `
    ) AS page
    JOIN issues i ON i.id = page.id JOIN users a ON a.id = i.author_id LEFT JOIN users s ON s.id = i.assignee_id` + order
	arguments = append(arguments, filters.PerPage, (filters.Page-1)*filters.PerPage)
	batch.Queue(query, arguments...).Query(func(rows pgx.Rows) error {
		list := make([]issueSummary, 0, filters.PerPage)
		for rows.Next() {
			var row issueSummary
			var assigneeLogin, assigneeName *string
			if err := rows.Scan(summaryFields(&row, &assigneeLogin, &assigneeName)...); err != nil {
				return err
			}
			row.Assignee, row.Labels = assigneeOf(assigneeLogin, assigneeName), []label{}
			list = append(list, row)
		}
		*issues = list
		return rows.Err()
	})
}

func queueLabelsOfIssues(batch *pgx.Batch, issues []issueSummary) {
	ids := make([]int32, len(issues))
	place := make(map[int32]int, len(issues))
	for i := range issues {
		ids[i], place[issues[i].ID] = issues[i].ID, i
	}
	batch.Queue(`SELECT il.issue_id, l.id, l.name, l.color
    FROM issue_labels il JOIN labels l ON l.id = il.label_id
    WHERE il.issue_id = ANY($1)
    ORDER BY l.name`, ids).Query(func(rows pgx.Rows) error {
		for rows.Next() {
			var issueID int32
			var l label
			if err := rows.Scan(&issueID, &l.ID, &l.Name, &l.Color); err != nil {
				return err
			}
			row := &issues[place[issueID]]
			row.Labels = append(row.Labels, l)
		}
		return rows.Err()
	})
}

func queueCountByState(batch *pgx.Batch, projectID int32, labelName *string, counts *stateCounts) {
	query := `SELECT open_issues, closed_issues FROM projects WHERE id = $1`
	arguments := []any{projectID}
	if labelName != nil {
		query = `SELECT count(*) FILTER (WHERE i.state = 'open')::int, count(*) FILTER (WHERE i.state = 'closed')::int
          FROM labels l JOIN issue_labels il ON il.label_id = l.id JOIN issues i ON i.id = il.issue_id
          WHERE l.project_id = $1 AND l.name = $2`
		arguments = append(arguments, *labelName)
	}
	batch.Queue(query, arguments...).QueryRow(func(row pgx.Row) error {
		return row.Scan(&counts.Open, &counts.Closed)
	})
}

func queueCountByLabel(batch *pgx.Batch, projectID int32, labels *[]labelCount) {
	batch.Queue(`SELECT id, name, color, open_issues FROM labels WHERE project_id = $1 ORDER BY name`, projectID).Query(func(rows pgx.Rows) error {
		list := make([]labelCount, 0, 12)
		for rows.Next() {
			var l labelCount
			if err := rows.Scan(&l.ID, &l.Name, &l.Color, &l.OpenIssues); err != nil {
				return err
			}
			list = append(list, l)
		}
		*labels = list
		return rows.Err()
	})
}

type foundIssue struct {
	project project
	issue   issue
}

func queueIssue(batch *pgx.Batch, projectSlug string, number int32, found **foundIssue) {
	batch.Queue(`SELECT `+summaryColumns+`,
           i.body, i.closed_at, p.id, p.slug, p.name, p.description
    FROM projects p JOIN issues i ON i.project_id = p.id
    JOIN users a ON a.id = i.author_id LEFT JOIN users s ON s.id = i.assignee_id
    WHERE p.slug = $1 AND i.number = $2`, projectSlug, number).QueryRow(func(row pgx.Row) error {
		var f foundIssue
		var assigneeLogin, assigneeName *string
		var closedAt *time.Time
		fields := append(summaryFields(&f.issue.issueSummary, &assigneeLogin, &assigneeName),
			&f.issue.Body, &closedAt, &f.project.ID, &f.project.Slug, &f.project.Name, &f.project.Description)
		if err := row.Scan(fields...); err != nil {
			return ignoreNoRows(err)
		}
		f.issue.Assignee, f.issue.Labels, f.issue.ClosedAt = assigneeOf(assigneeLogin, assigneeName), []label{}, optional(closedAt)
		*found = &f
		return nil
	})
}

func queueLabelsOf(batch *pgx.Batch, issueID int32, labels *[]label) {
	batch.Queue(`SELECT l.id, l.name, l.color
    FROM issue_labels il JOIN labels l ON l.id = il.label_id
    WHERE il.issue_id = $1
    ORDER BY l.name`, issueID).Query(func(rows pgx.Rows) error {
		for rows.Next() {
			var l label
			if err := rows.Scan(&l.ID, &l.Name, &l.Color); err != nil {
				return err
			}
			*labels = append(*labels, l)
		}
		return rows.Err()
	})
}

func queueCommentsOf(batch *pgx.Batch, issueID, expected int32, comments *[]comment) {
	batch.Queue(`SELECT c.id, c.parent_id, c.body, c.created_at, c.edited_at, u.login, u.name
    FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.issue_id = $1
    ORDER BY c.id`, issueID).Query(func(rows pgx.Rows) error {
		list := make([]comment, 0, expected)
		for rows.Next() {
			var c comment
			var editedAt *time.Time
			if err := rows.Scan(&c.ID, &c.ParentID, &c.Body, (*time.Time)(&c.CreatedAt), &editedAt, &c.Author.Login, &c.Author.Name); err != nil {
				return err
			}
			c.EditedAt = optional(editedAt)
			list = append(list, c)
		}
		*comments = list
		return rows.Err()
	})
}

const mentionColumns = `p.slug, p.name, i.number, i.title, i.state, i.created_at, a.login, a.name`

func mentionFields(m *issueMention) []any {
	return []any{&m.Project.Slug, &m.Project.Name, &m.Number, &m.Title, &m.State, (*time.Time)(&m.CreatedAt), &m.Author.Login, &m.Author.Name}
}

func collectMentions(list *[]issueMention) func(pgx.Rows) error {
	return func(rows pgx.Rows) error {
		*list = []issueMention{}
		for rows.Next() {
			var m issueMention
			if err := rows.Scan(mentionFields(&m)...); err != nil {
				return err
			}
			*list = append(*list, m)
		}
		return rows.Err()
	}
}

func queueProjects(batch *pgx.Batch, list *[]projectSummary) {
	batch.Queue(`SELECT id, slug, name, description, open_issues, closed_issues
    FROM projects
    ORDER BY open_issues DESC, id`).Query(func(rows pgx.Rows) error {
		*list = make([]projectSummary, 0, 64)
		for rows.Next() {
			var p projectSummary
			if err := rows.Scan(&p.ID, &p.Slug, &p.Name, &p.Description, &p.OpenIssues, &p.ClosedIssues); err != nil {
				return err
			}
			*list = append(*list, p)
		}
		return rows.Err()
	})
}

func queueNewestIssues(batch *pgx.Batch, limit int, list *[]issueMention) {
	batch.Queue(`SELECT `+mentionColumns+`
    FROM issues i JOIN projects p ON p.id = i.project_id JOIN users a ON a.id = i.author_id
    ORDER BY i.created_at DESC
    LIMIT $1`, limit).Query(collectMentions(list))
}

func queueLabelsOfProject(batch *pgx.Batch, projectID int32, labels *[]label) {
	batch.Queue(`SELECT id, name, color FROM labels WHERE project_id = $1 ORDER BY name`, projectID).Query(func(rows pgx.Rows) error {
		for rows.Next() {
			var l label
			if err := rows.Scan(&l.ID, &l.Name, &l.Color); err != nil {
				return err
			}
			*labels = append(*labels, l)
		}
		return rows.Err()
	})
}

func queueSearch(batch *pgx.Batch, text string, limit, offset int, hits *[]searchHit) {
	batch.Queue(`SELECT `+mentionColumns+`, i.body, i.comment_count
    FROM issues i JOIN projects p ON p.id = i.project_id JOIN users a ON a.id = i.author_id
    WHERE i.search @@ websearch_to_tsquery('english', $1)
    ORDER BY ts_rank(i.search, websearch_to_tsquery('english', $1)) DESC, i.id DESC
    LIMIT $2 OFFSET $3`, text, limit, offset).Query(func(rows pgx.Rows) error {
		*hits = make([]searchHit, 0, limit)
		for rows.Next() {
			var hit searchHit
			if err := rows.Scan(append(mentionFields(&hit.issueMention), &hit.Body, &hit.CommentCount)...); err != nil {
				return err
			}
			*hits = append(*hits, hit)
		}
		return rows.Err()
	})
}

func queueCountHits(batch *pgx.Batch, text string, total *int32) {
	batch.Queue(`SELECT count(*)::int FROM issues i WHERE i.search @@ websearch_to_tsquery('english', $1)`, text).QueryRow(func(row pgx.Row) error {
		return row.Scan(total)
	})
}

func queueUser(batch *pgx.Batch, login string, found **user) {
	batch.Queue(`SELECT id, login, name, bio, role, created_at FROM users WHERE login = $1`, login).QueryRow(func(row pgx.Row) error {
		var u user
		if err := row.Scan(&u.ID, &u.Login, &u.Name, &u.Bio, &u.Role, (*time.Time)(&u.CreatedAt)); err != nil {
			return ignoreNoRows(err)
		}
		*found = &u
		return nil
	})
}

func queueProfile(batch *pgx.Batch, p *profile) {
	id := p.User.ID
	batch.Queue(`SELECT (SELECT count(*) FROM issues WHERE author_id = $1)::int,
           (SELECT count(*) FROM comments WHERE author_id = $1)::int`, id).QueryRow(func(row pgx.Row) error {
		return row.Scan(&p.IssueCount, &p.CommentCount)
	})
	batch.Queue(`SELECT `+mentionColumns+`
    FROM issues i JOIN projects p ON p.id = i.project_id JOIN users a ON a.id = i.author_id
    WHERE i.author_id = $1
    ORDER BY i.created_at DESC
    LIMIT $2`, id, 10).Query(collectMentions(&p.Issues))
	batch.Queue(`SELECT c.id, p.slug, p.name, i.number, i.title, c.body, c.created_at
    FROM comments c JOIN issues i ON i.id = c.issue_id JOIN projects p ON p.id = i.project_id
    WHERE c.author_id = $1
    ORDER BY c.created_at DESC
    LIMIT $2`, id, 10).Query(func(rows pgx.Rows) error {
		p.Comments = []commentMention{}
		for rows.Next() {
			var c commentMention
			if err := rows.Scan(&c.ID, &c.Project.Slug, &c.Project.Name, &c.Issue.Number, &c.Issue.Title, &c.Body, (*time.Time)(&c.CreatedAt)); err != nil {
				return err
			}
			p.Comments = append(p.Comments, c)
		}
		return rows.Err()
	})
}

func collect[T any](list *[]T, fields func(*T) []any) func(pgx.Rows) error {
	return func(rows pgx.Rows) error {
		*list = []T{}
		for rows.Next() {
			var row T
			if err := rows.Scan(fields(&row)...); err != nil {
				return err
			}
			*list = append(*list, row)
		}
		return rows.Err()
	}
}

func queueAdminStats(batch *pgx.Batch, stats *adminStats) {
	batch.Queue(`SELECT (SELECT count(*) FROM users)::int,
             (SELECT count(*) FROM projects)::int,
             (SELECT sum(open_issues) FROM projects)::int,
             (SELECT sum(closed_issues) FROM projects)::int,
             (SELECT count(*) FROM comments)::int`).QueryRow(func(row pgx.Row) error {
		t := &stats.Totals
		return row.Scan(&t.Users, &t.Projects, &t.OpenIssues, &t.ClosedIssues, &t.Comments)
	})
	batch.Queue(`SELECT to_char(month, 'YYYY-MM'),
             (SELECT count(*) FROM issues WHERE created_at >= month AND created_at < month + interval '1 month')::int,
             (SELECT count(*) FROM issues WHERE closed_at >= month AND closed_at < month + interval '1 month')::int
      FROM generate_series(timestamptz '2025-06-01 00:00:00+00', timestamptz '2026-05-01 00:00:00+00', interval '1 month') AS month
      ORDER BY month`).Query(collect(&stats.Months, func(m *monthCount) []any { return []any{&m.Month, &m.Opened, &m.Closed} }))
	batch.Queue(`SELECT priority,
             count(*) FILTER (WHERE state = 'open')::int,
             coalesce(round(extract(epoch FROM avg(closed_at - created_at)) / 60), 0)::int
      FROM issues
      GROUP BY priority
      ORDER BY priority DESC`).Query(collect(&stats.Priorities, func(p *priorityCount) []any { return []any{&p.Priority, &p.Open, &p.MinutesToClose} }))
	batch.Queue(`SELECT u.login, u.name, busy.comments
      FROM (SELECT author_id, count(*)::int AS comments FROM comments GROUP BY author_id ORDER BY comments DESC, author_id LIMIT 10) AS busy
      JOIN users u ON u.id = busy.author_id
      ORDER BY busy.comments DESC, u.id`).Query(collect(&stats.Commenters, func(c *commenter) []any { return []any{&c.Login, &c.Name, &c.Comments} }))
	batch.Queue(`SELECT p.slug, p.name, sum(i.comment_count)::int AS comments
      FROM projects p JOIN issues i ON i.project_id = p.id
      GROUP BY p.id
      ORDER BY comments DESC, p.id
      LIMIT 10`).Query(collect(&stats.Busiest, func(b *busyProject) []any { return []any{&b.Slug, &b.Name, &b.Comments} }))
}
