package main

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type issueFields struct {
	title      string
	body       string
	priority   int
	labels     []string
	assigneeID *int32
}

// The id of the user with that login, or nil.
func findUserID(ctx context.Context, conn *pgxpool.Conn, login string) (*int32, error) {
	var id int32
	if err := conn.QueryRow(ctx, `SELECT id FROM users WHERE login = $1`, login).Scan(&id); err != nil {
		return nil, ignoreNoRows(err)
	}
	return &id, nil
}

func setLabels(ctx context.Context, tx pgx.Tx, issueID, projectID int32, labels []string) error {
	if len(labels) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO issue_labels (issue_id, label_id)
        SELECT $1, id FROM labels WHERE project_id = $2 AND name = ANY($3)`, issueID, projectID, labels)
	return err
}

func setFlash(ctx context.Context, tx pgx.Tx, s *session, flash string) error {
	if flash == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `UPDATE sessions SET flash = $1 WHERE token = $2`, flash, s.Token)
	return err
}

// Makes the issue and says which number it got. flash is shown to the author on the next page.
func insertIssue(ctx context.Context, conn *pgxpool.Conn, p *project, s *session, fields issueFields, flash string) (number int32, err error) {
	err = pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `UPDATE projects SET next_number = next_number + 1, open_issues = open_issues + 1
      WHERE id = $1
      RETURNING next_number - 1`, p.ID).Scan(&number); err != nil {
			return err
		}
		var id int32
		if err := tx.QueryRow(ctx, `INSERT INTO issues (project_id, number, author_id, assignee_id, title, body, state, priority, comment_count, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, 0, now(), now())
      RETURNING id`, p.ID, number, s.User.ID, fields.assigneeID, fields.title, fields.body, fields.priority).Scan(&id); err != nil {
			return err
		}
		if err := setLabels(ctx, tx, id, p.ID, fields.labels); err != nil {
			return err
		}
		if len(fields.labels) > 0 {
			if _, err := tx.Exec(ctx, `UPDATE labels SET open_issues = open_issues + 1 WHERE project_id = $1 AND name = ANY($2)`, p.ID, fields.labels); err != nil {
				return err
			}
		}
		return setFlash(ctx, tx, s, flash)
	})
	return number, err
}

func updateIssue(ctx context.Context, conn *pgxpool.Conn, p *project, i *issue, s *session, fields issueFields, state, flash string) error {
	return pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE issues
      SET title = $1, body = $2, priority = $3, assignee_id = $4, state = $5,
          closed_at = CASE WHEN $5 = 'closed' THEN coalesce(closed_at, now()) END, updated_at = now()
      WHERE id = $6`, fields.title, fields.body, fields.priority, fields.assigneeID, state, i.ID); err != nil {
			return err
		}
		if state != i.State {
			opened := -1
			if state == "open" {
				opened = 1
			}
			if _, err := tx.Exec(ctx, `UPDATE projects SET open_issues = open_issues + $1, closed_issues = closed_issues - $1 WHERE id = $2`, opened, p.ID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM issue_labels WHERE issue_id = $1`, i.ID); err != nil {
			return err
		}
		if err := setLabels(ctx, tx, i.ID, p.ID, fields.labels); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE labels l
      SET open_issues = (SELECT count(*) FROM issue_labels il JOIN issues i ON i.id = il.issue_id WHERE il.label_id = l.id AND i.state = 'open')
      WHERE l.project_id = $1`, p.ID); err != nil {
			return err
		}
		return setFlash(ctx, tx, s, flash)
	})
}

func commentBelongsTo(ctx context.Context, conn *pgxpool.Conn, commentID int, issueID int32) (bool, error) {
	var one int32
	err := conn.QueryRow(ctx, `SELECT 1 FROM comments WHERE id = $1 AND issue_id = $2`, commentID, issueID).Scan(&one)
	return err == nil, ignoreNoRows(err)
}

func insertComment(ctx context.Context, conn *pgxpool.Conn, i *issue, s *session, body string, parentID *int, flash string) (id int32, createdAt timestamp, err error) {
	err = pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO comments (issue_id, parent_id, author_id, body, created_at)
      VALUES ($1, $2, $3, $4, now())
      RETURNING id, created_at`, i.ID, parentID, s.User.ID, body).Scan(&id, (*time.Time)(&createdAt)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE issues SET comment_count = comment_count + 1, updated_at = now() WHERE id = $1`, i.ID); err != nil {
			return err
		}
		return setFlash(ctx, tx, s, flash)
	})
	return id, createdAt, err
}
