use deadpool_postgres::{Client, Transaction};

use crate::types::*;
use crate::Failure;

pub struct IssueFields {
    pub title: String,
    pub body: String,
    pub priority: i32,
    pub labels: Vec<String>,
    pub assignee_id: Option<i32>,
}

async fn set_labels(tx: &Transaction<'_>, issue_id: i32, project_id: i32, labels: &[String]) -> Result<(), Failure> {
    if !labels.is_empty() {
        let insert = tx
            .prepare_cached(
                "INSERT INTO issue_labels (issue_id, label_id)
                 SELECT $1, id FROM labels WHERE project_id = $2 AND name = ANY($3)",
            )
            .await?;
        tx.execute(&insert, &[&issue_id, &project_id, &labels]).await?;
    }
    Ok(())
}

async fn set_flash(tx: &Transaction<'_>, session: &Session, flash: Option<&str>) -> Result<(), Failure> {
    if let Some(flash) = flash {
        let update = tx.prepare_cached("UPDATE sessions SET flash = $1 WHERE token = $2").await?;
        tx.execute(&update, &[&flash, &session.token]).await?;
    }
    Ok(())
}

/// Makes the issue and says which number it got. `flash` is shown to the author on the next page.
pub async fn insert_issue(client: &mut Client, project: &Project, session: &Session, fields: &IssueFields, flash: Option<&str>) -> Result<i32, Failure> {
    let tx = client.transaction().await?;
    let take = tx
        .prepare_cached(
            "UPDATE projects SET next_number = next_number + 1, open_issues = open_issues + 1
             WHERE id = $1
             RETURNING next_number - 1",
        )
        .await?;
    let number: i32 = tx.query_one(&take, &[&project.id]).await?.get(0);
    let insert = tx
        .prepare_cached(
            "INSERT INTO issues (project_id, number, author_id, assignee_id, title, body, state, priority, comment_count, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, 0, now(), now())
             RETURNING id",
        )
        .await?;
    let id: i32 = tx.query_one(&insert, &[&project.id, &number, &session.user.id, &fields.assignee_id, &fields.title, &fields.body, &fields.priority]).await?.get(0);
    set_labels(&tx, id, project.id, &fields.labels).await?;
    if !fields.labels.is_empty() {
        let count = tx.prepare_cached("UPDATE labels SET open_issues = open_issues + 1 WHERE project_id = $1 AND name = ANY($2)").await?;
        tx.execute(&count, &[&project.id, &fields.labels]).await?;
    }
    set_flash(&tx, session, flash).await?;
    tx.commit().await?;
    Ok(number)
}

pub async fn update_issue(
    client: &mut Client,
    project: &Project,
    issue: &Issue,
    session: &Session,
    fields: &IssueFields,
    state: &str,
    flash: Option<&str>,
) -> Result<(), Failure> {
    let tx = client.transaction().await?;
    let update = tx
        .prepare_cached(
            "UPDATE issues
             SET title = $1, body = $2, priority = $3, assignee_id = $4, state = $5,
                 closed_at = CASE WHEN $5 = 'closed' THEN coalesce(closed_at, now()) END, updated_at = now()
             WHERE id = $6",
        )
        .await?;
    tx.execute(&update, &[&fields.title, &fields.body, &fields.priority, &fields.assignee_id, &state, &issue.id]).await?;
    if state != issue.state {
        let opened: i32 = if state == "open" { 1 } else { -1 };
        let count = tx.prepare_cached("UPDATE projects SET open_issues = open_issues + $1, closed_issues = closed_issues - $1 WHERE id = $2").await?;
        tx.execute(&count, &[&opened, &project.id]).await?;
    }
    let clear = tx.prepare_cached("DELETE FROM issue_labels WHERE issue_id = $1").await?;
    tx.execute(&clear, &[&issue.id]).await?;
    set_labels(&tx, issue.id, project.id, &fields.labels).await?;
    let recount = tx
        .prepare_cached(
            "UPDATE labels l
             SET open_issues = (SELECT count(*) FROM issue_labels il JOIN issues i ON i.id = il.issue_id WHERE il.label_id = l.id AND i.state = 'open')
             WHERE l.project_id = $1",
        )
        .await?;
    tx.execute(&recount, &[&project.id]).await?;
    set_flash(&tx, session, flash).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn comment_belongs_to(client: &Client, comment_id: i32, issue_id: i32) -> Result<bool, Failure> {
    let select = client.prepare_cached("SELECT 1 FROM comments WHERE id = $1 AND issue_id = $2").await?;
    Ok(client.query_opt(&select, &[&comment_id, &issue_id]).await?.is_some())
}

pub async fn insert_comment(
    client: &mut Client,
    issue: &Issue,
    session: &Session,
    body: &str,
    parent_id: Option<i32>,
    flash: Option<&str>,
) -> Result<(i32, Timestamp), Failure> {
    let tx = client.transaction().await?;
    let insert = tx
        .prepare_cached(
            "INSERT INTO comments (issue_id, parent_id, author_id, body, created_at)
             VALUES ($1, $2, $3, $4, now())
             RETURNING id, created_at",
        )
        .await?;
    let row = tx.query_one(&insert, &[&issue.id, &parent_id, &session.user.id, &body]).await?;
    let count = tx.prepare_cached("UPDATE issues SET comment_count = comment_count + 1, updated_at = now() WHERE id = $1").await?;
    tx.execute(&count, &[&issue.id]).await?;
    set_flash(&tx, session, flash).await?;
    tx.commit().await?;
    Ok((row.get(0), row.get(1)))
}
