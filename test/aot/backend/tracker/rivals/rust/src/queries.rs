//! Queries that are awaited together (tokio::try_join!) go to the server together, on one connection.

use deadpool_postgres::Client;
use rustc_hash::FxHashMap;
use tokio_postgres::types::ToSql;
use tokio_postgres::Row;

use crate::filters::IssueFilters;
use crate::types::*;
use crate::Failure;

macro_rules! summary_columns {
    () => {
        "i.id, i.number, i.title, i.state, i.priority, i.comment_count, i.created_at, i.updated_at, a.login, a.name, s.login, s.name"
    };
}

fn assignee_of(row: &Row) -> Option<UserRef> {
    Some(UserRef { login: row.get::<_, Option<String>>(10)?, name: row.get::<_, Option<String>>(11)? })
}

pub async fn find_session(client: &Client, token: Option<&str>) -> Result<Option<Session>, Failure> {
    let Some(token) = token else { return Ok(None) };
    let select = client
        .prepare_cached(
            "SELECT s.token, s.csrf_token, s.flash, u.id, u.login, u.name, u.role
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = $1 AND s.expires_at > now()",
        )
        .await?;
    let Some(row) = client.query_opt(&select, &[&token]).await? else { return Ok(None) };
    let session = Session {
        token: row.get(0),
        csrf_token: row.get(1),
        flash: row.get(2),
        user: SessionUser { id: row.get(3), login: row.get(4), name: row.get(5), role: row.get(6) },
    };
    if session.flash.is_some() {
        let forget = client.prepare_cached("UPDATE sessions SET flash = NULL WHERE token = $1").await?;
        client.execute(&forget, &[&token]).await?;
    }
    Ok(Some(session))
}

pub async fn find_project(client: &Client, slug: &str) -> Result<Option<Project>, Failure> {
    let select = client.prepare_cached("SELECT id, slug, name, description FROM projects WHERE slug = $1").await?;
    Ok(client.query_opt(&select, &[&slug]).await?.map(|row| Project { id: row.get(0), slug: row.get(1), name: row.get(2), description: row.get(3) }))
}

pub async fn list_issues(client: &Client, project_id: i32, filters: &IssueFilters) -> Result<Vec<IssueSummary>, Failure> {
    let mut query = String::from(concat!(
        "SELECT ",
        summary_columns!(),
        " FROM (
            SELECT i.id FROM issues i
            WHERE i.project_id = $1 AND i.state = $2"
    ));
    let offset = (filters.page - 1) * filters.per_page;
    let mut arguments: Vec<&(dyn ToSql + Sync)> = vec![&project_id, &filters.state];
    if let Some(label) = &filters.label {
        query.push_str(" AND EXISTS (SELECT 1 FROM issue_labels il JOIN labels l ON l.id = il.label_id WHERE il.issue_id = i.id AND l.name = $3)");
        arguments.push(label);
    }
    let order = match filters.sort {
        "created" => " ORDER BY i.created_at DESC, i.id DESC",
        "comments" => " ORDER BY i.comment_count DESC, i.id DESC",
        _ => " ORDER BY i.updated_at DESC, i.id DESC",
    };
    query.push_str(order);
    query.push_str(if filters.label.is_some() { " LIMIT $4 OFFSET $5" } else { " LIMIT $3 OFFSET $4" });
    query.push_str(") AS page JOIN issues i ON i.id = page.id JOIN users a ON a.id = i.author_id LEFT JOIN users s ON s.id = i.assignee_id");
    query.push_str(order);
    arguments.push(&filters.per_page);
    arguments.push(&offset);
    let select = client.prepare_cached(&query).await?;
    let mut issues: Vec<IssueSummary> = client
        .query(&select, &arguments)
        .await?
        .iter()
        .map(|row| IssueSummary {
            id: row.get(0),
            number: row.get(1),
            title: row.get(2),
            state: row.get(3),
            priority: row.get(4),
            comment_count: row.get(5),
            created_at: row.get(6),
            updated_at: row.get(7),
            author: UserRef { login: row.get(8), name: row.get(9) },
            assignee: assignee_of(row),
            labels: Vec::new(),
        })
        .collect();
    if issues.is_empty() {
        return Ok(issues);
    }

    let ids: Vec<i32> = issues.iter().map(|issue| issue.id).collect();
    let places: FxHashMap<i32, usize> = ids.iter().enumerate().map(|(place, &id)| (id, place)).collect();
    let select = client
        .prepare_cached(
            "SELECT il.issue_id, l.id, l.name, l.color
             FROM issue_labels il JOIN labels l ON l.id = il.label_id
             WHERE il.issue_id = ANY($1)
             ORDER BY l.name",
        )
        .await?;
    for row in client.query(&select, &[&ids]).await? {
        issues[places[&row.get::<_, i32>(0)]].labels.push(Label { id: row.get(1), name: row.get(2), color: row.get(3) });
    }
    Ok(issues)
}

pub async fn count_by_state(client: &Client, project_id: i32, label: Option<&String>) -> Result<StateCounts, Failure> {
    let row = match label {
        None => client.query_one(&client.prepare_cached("SELECT open_issues, closed_issues FROM projects WHERE id = $1").await?, &[&project_id]).await?,
        Some(label) => {
            let select = client
                .prepare_cached(
                    "SELECT count(*) FILTER (WHERE i.state = 'open')::int, count(*) FILTER (WHERE i.state = 'closed')::int
                     FROM labels l JOIN issue_labels il ON il.label_id = l.id JOIN issues i ON i.id = il.issue_id
                     WHERE l.project_id = $1 AND l.name = $2",
                )
                .await?;
            client.query_one(&select, &[&project_id, label]).await?
        }
    };
    Ok(StateCounts { open: row.get(0), closed: row.get(1) })
}

pub async fn count_by_label(client: &Client, project_id: i32) -> Result<Vec<LabelCount>, Failure> {
    let select = client.prepare_cached("SELECT id, name, color, open_issues FROM labels WHERE project_id = $1 ORDER BY name").await?;
    let rows = client.query(&select, &[&project_id]).await?;
    Ok(rows.iter().map(|row| LabelCount { label: Label { id: row.get(0), name: row.get(1), color: row.get(2) }, open_issues: row.get(3) }).collect())
}

pub async fn find_issue(client: &Client, project_slug: &str, number: Option<i32>) -> Result<Option<(Project, Issue)>, Failure> {
    let Some(number) = number else { return Ok(None) };
    let select = client
        .prepare_cached(concat!(
            "SELECT ",
            summary_columns!(),
            ", i.body, i.closed_at, p.id, p.slug, p.name, p.description
             FROM projects p JOIN issues i ON i.project_id = p.id
             JOIN users a ON a.id = i.author_id LEFT JOIN users s ON s.id = i.assignee_id
             WHERE p.slug = $1 AND i.number = $2"
        ))
        .await?;
    Ok(client.query_opt(&select, &[&project_slug, &number]).await?.map(|row| {
        (
            Project { id: row.get(14), slug: row.get(15), name: row.get(16), description: row.get(17) },
            Issue {
                id: row.get(0),
                number: row.get(1),
                title: row.get(2),
                state: row.get(3),
                priority: row.get(4),
                comment_count: row.get(5),
                created_at: row.get(6),
                updated_at: row.get(7),
                author: UserRef { login: row.get(8), name: row.get(9) },
                assignee: assignee_of(&row),
                labels: Vec::new(),
                body: row.get(12),
                closed_at: row.get(13),
            },
        )
    }))
}

pub async fn labels_of(client: &Client, issue_id: i32) -> Result<Vec<Label>, Failure> {
    let select = client
        .prepare_cached(
            "SELECT l.id, l.name, l.color
             FROM issue_labels il JOIN labels l ON l.id = il.label_id
             WHERE il.issue_id = $1
             ORDER BY l.name",
        )
        .await?;
    Ok(client.query(&select, &[&issue_id]).await?.iter().map(|row| Label { id: row.get(0), name: row.get(1), color: row.get(2) }).collect())
}

pub async fn comments_of(client: &Client, issue_id: i32) -> Result<Vec<Comment>, Failure> {
    let select = client
        .prepare_cached(
            "SELECT c.id, c.parent_id, c.body, c.created_at, c.edited_at, u.login, u.name
             FROM comments c JOIN users u ON u.id = c.author_id
             WHERE c.issue_id = $1
             ORDER BY c.id",
        )
        .await?;
    let rows = client.query(&select, &[&issue_id]).await?;
    Ok(rows
        .iter()
        .map(|row| Comment {
            id: row.get(0),
            parent_id: row.get(1),
            author: UserRef { login: row.get(5), name: row.get(6) },
            body: row.get(2),
            created_at: row.get(3),
            edited_at: row.get(4),
            replies: Vec::new(),
        })
        .collect())
}

macro_rules! mention_columns {
    () => {
        "p.slug, p.name, i.number, i.title, i.state, i.created_at, a.login, a.name"
    };
}

fn mention_of(row: &Row) -> IssueMention {
    IssueMention {
        project: ProjectRef { slug: row.get(0), name: row.get(1) },
        number: row.get(2),
        title: row.get(3),
        state: row.get(4),
        created_at: row.get(5),
        author: UserRef { login: row.get(6), name: row.get(7) },
    }
}

pub async fn list_projects(client: &Client) -> Result<Vec<ProjectSummary>, Failure> {
    let select = client
        .prepare_cached(
            "SELECT id, slug, name, description, open_issues, closed_issues
             FROM projects
             ORDER BY open_issues DESC, id",
        )
        .await?;
    let rows = client.query(&select, &[]).await?;
    Ok(rows
        .iter()
        .map(|row| ProjectSummary { id: row.get(0), slug: row.get(1), name: row.get(2), description: row.get(3), open_issues: row.get(4), closed_issues: row.get(5) })
        .collect())
}

pub async fn newest_issues(client: &Client, limit: i64) -> Result<Vec<IssueMention>, Failure> {
    let select = client
        .prepare_cached(concat!(
            "SELECT ",
            mention_columns!(),
            " FROM issues i JOIN projects p ON p.id = i.project_id JOIN users a ON a.id = i.author_id
              ORDER BY i.created_at DESC
              LIMIT $1"
        ))
        .await?;
    Ok(client.query(&select, &[&limit]).await?.iter().map(mention_of).collect())
}

pub async fn labels_of_project(client: &Client, project_id: i32) -> Result<Vec<Label>, Failure> {
    let select = client.prepare_cached("SELECT id, name, color FROM labels WHERE project_id = $1 ORDER BY name").await?;
    Ok(client.query(&select, &[&project_id]).await?.iter().map(|row| Label { id: row.get(0), name: row.get(1), color: row.get(2) }).collect())
}

pub async fn search_issues(client: &Client, text: &str, limit: i64, offset: i64) -> Result<Vec<SearchHit>, Failure> {
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let select = client
        .prepare_cached(concat!(
            "SELECT ",
            mention_columns!(),
            ", i.body, i.comment_count
             FROM issues i JOIN projects p ON p.id = i.project_id JOIN users a ON a.id = i.author_id
             WHERE i.search @@ websearch_to_tsquery('english', $1)
             ORDER BY ts_rank(i.search, websearch_to_tsquery('english', $1)) DESC, i.id DESC
             LIMIT $2 OFFSET $3"
        ))
        .await?;
    let rows = client.query(&select, &[&text, &limit, &offset]).await?;
    Ok(rows.iter().map(|row| SearchHit { issue: mention_of(row), body: row.get(8), comment_count: row.get(9) }).collect())
}

pub async fn count_hits(client: &Client, text: &str) -> Result<i32, Failure> {
    if text.is_empty() {
        return Ok(0);
    }
    let select = client.prepare_cached("SELECT count(*)::int FROM issues i WHERE i.search @@ websearch_to_tsquery('english', $1)").await?;
    Ok(client.query_one(&select, &[&text]).await?.get(0))
}

pub async fn find_user_id(client: &Client, login: &str) -> Result<Option<i32>, Failure> {
    let select = client.prepare_cached("SELECT id FROM users WHERE login = $1").await?;
    Ok(client.query_opt(&select, &[&login]).await?.map(|row| row.get(0)))
}

pub struct Password {
    pub user_id: i32,
    pub salt: String,
    pub hash: String,
}

pub async fn find_password(client: &Client, login: &str) -> Result<Option<Password>, Failure> {
    let select = client.prepare_cached("SELECT id, password_salt, password_hash FROM users WHERE login = $1").await?;
    Ok(client.query_opt(&select, &[&login]).await?.map(|row| Password { user_id: row.get(0), salt: row.get(1), hash: row.get(2) }))
}

async fn count_written(client: &Client, user_id: i32) -> Result<(i32, i32), Failure> {
    let select = client
        .prepare_cached(
            "SELECT (SELECT count(*) FROM issues WHERE author_id = $1)::int,
                    (SELECT count(*) FROM comments WHERE author_id = $1)::int",
        )
        .await?;
    let row = client.query_one(&select, &[&user_id]).await?;
    Ok((row.get(0), row.get(1)))
}

async fn issues_by(client: &Client, user_id: i32, limit: i64) -> Result<Vec<IssueMention>, Failure> {
    let select = client
        .prepare_cached(concat!(
            "SELECT ",
            mention_columns!(),
            " FROM issues i JOIN projects p ON p.id = i.project_id JOIN users a ON a.id = i.author_id
              WHERE i.author_id = $1
              ORDER BY i.created_at DESC
              LIMIT $2"
        ))
        .await?;
    Ok(client.query(&select, &[&user_id, &limit]).await?.iter().map(mention_of).collect())
}

async fn comments_by(client: &Client, user_id: i32, limit: i64) -> Result<Vec<CommentMention>, Failure> {
    let select = client
        .prepare_cached(
            "SELECT c.id, p.slug, p.name, i.number, i.title, c.body, c.created_at
             FROM comments c JOIN issues i ON i.id = c.issue_id JOIN projects p ON p.id = i.project_id
             WHERE c.author_id = $1
             ORDER BY c.created_at DESC
             LIMIT $2",
        )
        .await?;
    let rows = client.query(&select, &[&user_id, &limit]).await?;
    Ok(rows
        .iter()
        .map(|row| CommentMention {
            id: row.get(0),
            project: ProjectRef { slug: row.get(1), name: row.get(2) },
            issue: IssueRef { number: row.get(3), title: row.get(4) },
            body: row.get(5),
            created_at: row.get(6),
        })
        .collect())
}

pub async fn load_profile(client: &Client, login: &str) -> Result<Option<Profile>, Failure> {
    let select = client.prepare_cached("SELECT id, login, name, bio, role, created_at FROM users WHERE login = $1").await?;
    let Some(row) = client.query_opt(&select, &[&login]).await? else { return Ok(None) };
    let user = User { id: row.get(0), login: row.get(1), name: row.get(2), bio: row.get(3), role: row.get(4), created_at: row.get(5) };
    let ((issue_count, comment_count), issues, comments) = tokio::try_join!(count_written(client, user.id), issues_by(client, user.id, 10), comments_by(client, user.id, 10))?;
    Ok(Some(Profile { user, issue_count, comment_count, issues, comments }))
}

async fn rows_of(client: &Client, query: &str) -> Result<Vec<Row>, Failure> {
    Ok(client.query(&client.prepare_cached(query).await?, &[]).await?)
}

pub async fn admin_stats(client: &Client) -> Result<AdminStats, Failure> {
    let (totals, months, priorities, commenters, busiest) = tokio::try_join!(
        rows_of(
            client,
            "SELECT (SELECT count(*) FROM users)::int,
                    (SELECT count(*) FROM projects)::int,
                    (SELECT sum(open_issues) FROM projects)::int,
                    (SELECT sum(closed_issues) FROM projects)::int,
                    (SELECT count(*) FROM comments)::int"
        ),
        rows_of(
            client,
            "SELECT to_char(month, 'YYYY-MM'),
                    (SELECT count(*) FROM issues WHERE created_at >= month AND created_at < month + interval '1 month')::int,
                    (SELECT count(*) FROM issues WHERE closed_at >= month AND closed_at < month + interval '1 month')::int
             FROM generate_series(timestamptz '2025-06-01 00:00:00+00', timestamptz '2026-05-01 00:00:00+00', interval '1 month') AS month
             ORDER BY month"
        ),
        rows_of(
            client,
            "SELECT priority,
                    count(*) FILTER (WHERE state = 'open')::int,
                    coalesce(round(extract(epoch FROM avg(closed_at - created_at)) / 60), 0)::int
             FROM issues
             GROUP BY priority
             ORDER BY priority DESC"
        ),
        rows_of(
            client,
            "SELECT u.login, u.name, busy.comments
             FROM (SELECT author_id, count(*)::int AS comments FROM comments GROUP BY author_id ORDER BY comments DESC, author_id LIMIT 10) AS busy
             JOIN users u ON u.id = busy.author_id
             ORDER BY busy.comments DESC, u.id"
        ),
        rows_of(
            client,
            "SELECT p.slug, p.name, sum(i.comment_count)::int AS comments
             FROM projects p JOIN issues i ON i.project_id = p.id
             GROUP BY p.id
             ORDER BY comments DESC, p.id
             LIMIT 10"
        ),
    )?;
    let row = &totals[0];
    Ok(AdminStats {
        totals: Totals { users: row.get(0), projects: row.get(1), open_issues: row.get(2), closed_issues: row.get(3), comments: row.get(4) },
        months: months.iter().map(|row| MonthCount { month: row.get(0), opened: row.get(1), closed: row.get(2) }).collect(),
        priorities: priorities.iter().map(|row| PriorityCount { priority: row.get(0), open: row.get(1), minutes_to_close: row.get(2) }).collect(),
        commenters: commenters.iter().map(|row| Commenter { login: row.get(0), name: row.get(1), comments: row.get(2) }).collect(),
        busiest: busiest.iter().map(|row| BusyProject { slug: row.get(0), name: row.get(1), comments: row.get(2) }).collect(),
    })
}
