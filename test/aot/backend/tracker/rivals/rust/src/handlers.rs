use std::sync::Arc;

use axum::{
    extract::{Path, RawQuery, State},
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use serde::Serialize;

use crate::filters::{parameter, parse_filters, positive_integer, IssueFilters};
use crate::format::push_int;
use crate::queries::*;
use crate::thread::{build_thread, participants_of};
use crate::types::*;
use crate::views::*;
use crate::{App, Failure};

pub fn html(status: StatusCode, body: String) -> Response {
    (status, [(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response()
}

pub fn json<T: Serialize>(status: StatusCode, value: &T) -> Result<Response, Failure> {
    Ok((status, [(header::CONTENT_TYPE, "application/json")], serde_json::to_vec(value)?).into_response())
}

#[derive(Serialize)]
struct Problem<'a> {
    error: &'a str,
}

pub fn problem(status: StatusCode, error: &str) -> Result<Response, Failure> {
    json(status, &Problem { error })
}

pub fn not_found_page(session: Option<&Session>) -> Response {
    html(StatusCode::NOT_FOUND, error_page(session, "Not found", "There is no such page."))
}

/// 304 where the client holds what the tag names.
pub fn not_modified(headers: &HeaderMap, etag: &str) -> Option<Response> {
    (headers.get(header::IF_NONE_MATCH)?.as_bytes() == etag.as_bytes()).then(|| (StatusCode::NOT_MODIFIED, [(header::ETAG, etag.to_string())]).into_response())
}

/// What the browser's cookie says the session is.
pub fn session_cookie(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::COOKIE)?.to_str().ok()?.split(';').find_map(|pair| pair.trim_start().strip_prefix("sid=")).filter(|token| !token.is_empty())
}

fn issue_tag(issue: &Issue, user: Option<i32>) -> String {
    let mut tag = String::with_capacity(48);
    tag.push('"');
    push_int(&mut tag, issue.id);
    tag.push('-');
    push_int(&mut tag, issue.updated_at.0.div_euclid(1000));
    tag.push('-');
    push_int(&mut tag, issue.comment_count);
    if let Some(user) = user {
        tag.push('-');
        push_int(&mut tag, user);
    }
    tag.push('"');
    tag
}

pub async fn issue_list_page(State(app): State<Arc<App>>, Path(project): Path<String>, RawQuery(query): RawQuery, headers: HeaderMap) -> Result<Response, Failure> {
    let client = app.pool.get().await?;
    let (session, project) = tokio::try_join!(find_session(&client, session_cookie(&headers)), find_project(&client, &project))?;
    let Some(project) = project else { return Ok(not_found_page(session.as_ref())) };
    let filters = parse_filters(query.as_deref().unwrap_or(""), 25, 25);
    let (issues, counts, labels) =
        tokio::try_join!(list_issues(&client, project.id, &filters), count_by_state(&client, project.id, filters.label.as_ref()), count_by_label(&client, project.id))?;
    let title = format!("Issues of {}", project.name);
    Ok(html(StatusCode::OK, layout(&title, session.as_ref(), "", |out| issue_list_view(out, &project, &filters, &issues, &counts, &labels, session.is_some()))))
}

pub async fn issue_page(
    State(app): State<Arc<App>>,
    Path((project, number)): Path<(String, String)>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Result<Response, Failure> {
    let client = app.pool.get().await?;
    let (session, found) = tokio::try_join!(find_session(&client, session_cookie(&headers)), find_issue(&client, &project, positive_integer(&number)))?;
    let Some((project, mut issue)) = found else { return Ok(not_found_page(session.as_ref())) };

    let etag = issue_tag(&issue, Some(session.as_ref().map_or(0, |session| session.user.id)));
    if !session.as_ref().is_some_and(|session| session.flash.as_deref().is_some_and(|flash| !flash.is_empty())) {
        if let Some(unchanged) = not_modified(&headers, &etag) {
            return Ok(unchanged);
        }
    }

    let (labels, comments) = tokio::try_join!(labels_of(&client, issue.id), comments_of(&client, issue.id))?;
    issue.labels = labels;
    let reply_to = parameter(query.as_deref().unwrap_or(""), "reply_to").and_then(|text| positive_integer(&text));
    let participants = participants_of(&comments);
    let thread = build_thread(comments);
    let title = format!("{} · Issue #{}", issue.title, issue.number);
    let body = layout(&title, session.as_ref(), "", |out| issue_page_view(out, &project, &issue, &thread, &participants, session.as_ref(), reply_to));
    Ok((
        [(header::CONTENT_TYPE, "text/html; charset=utf-8".to_string()), (header::ETAG, etag), (header::CACHE_CONTROL, "private, no-cache".to_string())],
        body,
    )
        .into_response())
}

#[derive(Serialize)]
struct IssueListAnswer<'a> {
    project: &'a Project,
    filters: &'a IssueFilters,
    total: i32,
    issues: &'a [IssueSummary],
}

pub async fn api_issue_list(State(app): State<Arc<App>>, Path(project): Path<String>, RawQuery(query): RawQuery) -> Result<Response, Failure> {
    let client = app.pool.get().await?;
    let Some(project) = find_project(&client, &project).await? else { return problem(StatusCode::NOT_FOUND, "no such project") };
    let filters = parse_filters(query.as_deref().unwrap_or(""), 50, 100);
    let (issues, counts) = tokio::try_join!(list_issues(&client, project.id, &filters), count_by_state(&client, project.id, filters.label.as_ref()))?;
    json(StatusCode::OK, &IssueListAnswer { project: &project, filters: &filters, total: counts.of(filters.state), issues: &issues })
}

#[derive(Serialize)]
struct IssueAnswer<'a> {
    project: &'a Project,
    issue: &'a Issue,
    participants: &'a [Participant],
    comments: &'a [Comment],
}

pub async fn api_issue(State(app): State<Arc<App>>, Path((project, number)): Path<(String, String)>, headers: HeaderMap) -> Result<Response, Failure> {
    let client = app.pool.get().await?;
    let Some((project, mut issue)) = find_issue(&client, &project, positive_integer(&number)).await? else { return problem(StatusCode::NOT_FOUND, "no such issue") };
    let etag = issue_tag(&issue, None);
    if let Some(unchanged) = not_modified(&headers, &etag) {
        return Ok(unchanged);
    }
    let (labels, comments) = tokio::try_join!(labels_of(&client, issue.id), comments_of(&client, issue.id))?;
    issue.labels = labels;
    let participants = participants_of(&comments);
    let thread = build_thread(comments);
    let body = serde_json::to_vec(&IssueAnswer { project: &project, issue: &issue, participants: &participants, comments: &thread })?;
    Ok(([(header::CONTENT_TYPE, "application/json".to_string()), (header::ETAG, etag)], body).into_response())
}

pub async fn not_found(uri: Uri) -> Result<Response, Failure> {
    if uri.path().starts_with("/api/") {
        problem(StatusCode::NOT_FOUND, "not found")
    } else {
        Ok(not_found_page(None))
    }
}
