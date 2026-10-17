use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Path, RawQuery, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use deadpool_postgres::Client;
use serde::Serialize;

use crate::assets::{STYLESHEET, STYLESHEET_TAG};
use crate::excerpt::summary;
use crate::filters::{parameter, positive_integer, whole_number};
use crate::handlers::*;
use crate::passwords::{password_matches, random_token};
use crate::queries::*;
use crate::types::*;
use crate::validation::*;
use crate::views::*;
use crate::writes::*;
use crate::{App, Failure};

type Answer = Result<Response, Failure>;

fn see_other(location: &str) -> Response {
    (StatusCode::SEE_OTHER, [(header::LOCATION, location.to_string())]).into_response()
}

fn forbidden(session: Option<&Session>, message: &str) -> Response {
    html(StatusCode::FORBIDDEN, error_page(session, "Forbidden", message))
}

/// What a client of the API says the session is: Authorization: Bearer <token>.
fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ")
}

pub async fn home_page(State(app): State<Arc<App>>, headers: HeaderMap) -> Answer {
    let client = app.pool.get().await?;
    let (session, projects, newest) = tokio::try_join!(find_session(&client, session_cookie(&headers)), list_projects(&client), newest_issues(&client, 10))?;
    Ok(html(StatusCode::OK, layout("Projects", session.as_ref(), "", |out| home_view(out, &projects, &newest))))
}

pub async fn stylesheet_file(headers: HeaderMap) -> Response {
    not_modified(&headers, &STYLESHEET_TAG).unwrap_or_else(|| {
        (
            [
                (header::CONTENT_TYPE, "text/css; charset=utf-8"),
                (header::ETAG, STYLESHEET_TAG.as_str()),
                (header::CACHE_CONTROL, "public, max-age=3600"),
            ],
            STYLESHEET,
        )
            .into_response()
    })
}

const HITS_PER_PAGE: i64 = 20;

fn search_words(query: Option<&str>) -> (String, i64) {
    let query = query.unwrap_or("");
    let text = parameter(query, "q").map_or_else(String::new, |text| text.trim().to_string());
    (text, whole_number(&parameter(query, "page").unwrap_or_default(), 1, 1, 1000))
}

pub async fn search_page(State(app): State<Arc<App>>, RawQuery(query): RawQuery, headers: HeaderMap) -> Answer {
    let (text, page) = search_words(query.as_deref());
    let client = app.pool.get().await?;
    let (session, hits, total) = tokio::try_join!(
        find_session(&client, session_cookie(&headers)),
        search_issues(&client, &text, HITS_PER_PAGE, (page - 1) * HITS_PER_PAGE),
        count_hits(&client, &text)
    )?;
    let title = if text.is_empty() { "Search".to_string() } else { format!("Search: {text}") };
    let terms: Vec<String> = text.to_lowercase().split_whitespace().map(str::to_string).collect();
    Ok(html(StatusCode::OK, layout(&title, session.as_ref(), &text, |out| search_view(out, &text, &terms, &hits, i64::from(total), page, HITS_PER_PAGE))))
}

pub async fn profile_page(State(app): State<Arc<App>>, Path(login): Path<String>, headers: HeaderMap) -> Answer {
    let client = app.pool.get().await?;
    let (session, profile) = tokio::try_join!(find_session(&client, session_cookie(&headers)), load_profile(&client, &login))?;
    let Some(profile) = profile else { return Ok(not_found_page(session.as_ref())) };
    Ok(html(StatusCode::OK, layout(&profile.user.name, session.as_ref(), "", |out| profile_view(out, &profile))))
}

pub async fn admin_page(State(app): State<Arc<App>>, headers: HeaderMap) -> Answer {
    let client = app.pool.get().await?;
    let Some(session) = find_session(&client, session_cookie(&headers)).await? else { return Ok(see_other("/login")) };
    if session.user.role != "admin" {
        return Ok(forbidden(Some(&session), "This page is for administrators."));
    }
    let stats = admin_stats(&client).await?;
    Ok(html(StatusCode::OK, layout("Admin", Some(&session), "", |out| admin_view(out, &stats))))
}

// What a browser posts: forms, checked against the session's token, answered with a redirect or with the form and what is wrong with it.

struct Form(Vec<(String, String)>);

impl Form {
    fn of(body: &Bytes) -> Self {
        Form(form_urlencoded::parse(body).into_owned().collect())
    }

    fn field(&self, name: &str) -> &str {
        self.0.iter().find(|(key, _)| key == name).map_or("", |(_, value)| value)
    }

    fn text(&self, name: &str) -> String {
        self.field(name).replace("\r\n", "\n").trim().to_string()
    }

    fn all(&self, name: &str) -> Vec<String> {
        self.0.iter().filter(|(key, _)| key == name).map(|(_, value)| value.clone()).collect()
    }
}

/// The session of someone who is signed in and whose form carries the token of the session. Otherwise, what to answer.
async fn signed(client: &Client, headers: &HeaderMap, form: &Form) -> Result<Result<Session, Response>, Failure> {
    let Some(session) = find_session(client, session_cookie(headers)).await? else { return Ok(Err(see_other("/login"))) };
    if form.field("csrf") != session.csrf_token {
        return Ok(Err(forbidden(Some(&session), "The form has expired. Go back, reload the page and try again.")));
    }
    Ok(Ok(session))
}

fn may_edit(session: &Session, issue: &Issue) -> bool {
    session.user.login == issue.author.login || session.user.role == "admin"
}

fn issue_values(form: &Form, with_state: bool) -> (IssueFormValues, IssueInput) {
    let values = IssueFormValues {
        title: form.text("title"),
        body: form.text("body"),
        priority: form.field("priority").parse().ok(),
        labels: form.all("labels"),
        assignee: form.field("assignee").trim().to_string(),
        state: with_state.then(|| if form.field("state") == "closed" { "closed" } else { "open" }),
    };
    let input = IssueInput {
        title: Some(Some(values.title.clone())),
        body: Some(Some(values.body.clone())),
        priority: Some(values.priority),
        labels: Some(Some(values.labels.iter().cloned().map(Some).collect())),
        assignee: (!values.assignee.is_empty()).then(|| Some(values.assignee.clone())),
        state: values.state.map(|state| Some(state.to_string())),
    };
    (values, input)
}

async fn issue_form_page(client: &Client, project: &Project, number: Option<i32>, values: &IssueFormValues, session: &Session, invalid: &[String], status: StatusCode) -> Answer {
    let labels = labels_of_project(client, project.id).await?;
    let title = match number {
        None => format!("New issue in {}", project.name),
        Some(number) => format!("Edit issue #{number}"),
    };
    Ok(html(status, layout(&title, Some(session), "", |out| issue_form_view(out, project, number, values, &labels, session, invalid))))
}

pub async fn new_issue_page(State(app): State<Arc<App>>, Path(project): Path<String>, headers: HeaderMap) -> Answer {
    let client = app.pool.get().await?;
    let (session, project) = tokio::try_join!(find_session(&client, session_cookie(&headers)), find_project(&client, &project))?;
    let Some(project) = project else { return Ok(not_found_page(session.as_ref())) };
    let Some(session) = session else { return Ok(see_other("/login")) };
    issue_form_page(&client, &project, None, &IssueFormValues { priority: Some(1), ..Default::default() }, &session, &[], StatusCode::OK).await
}

fn fields_of(values: IssueFormValues, assignee_id: Option<i32>) -> IssueFields {
    IssueFields { title: values.title, body: values.body, priority: values.priority.unwrap_or(0) as i32, labels: values.labels, assignee_id }
}

fn assignee_is_unknown() -> Vec<String> {
    vec!["assignee".to_string()]
}

pub async fn create_issue(State(app): State<Arc<App>>, Path(project): Path<String>, headers: HeaderMap, body: Bytes) -> Answer {
    let mut client = app.pool.get().await?;
    let form = Form::of(&body);
    let session = match signed(&client, &headers, &form).await? {
        Ok(session) => session,
        Err(answer) => return Ok(answer),
    };
    let Some(project) = find_project(&client, &project).await? else { return Ok(not_found_page(Some(&session))) };
    let (values, input) = issue_values(&form, false);
    let refusal = input.check(true);
    if !refusal.invalid.is_empty() {
        return issue_form_page(&client, &project, None, &values, &session, &refusal.invalid, StatusCode::UNPROCESSABLE_ENTITY).await;
    }
    let assignee_id = if values.assignee.is_empty() { None } else { find_user_id(&client, &values.assignee).await? };
    if !values.assignee.is_empty() && assignee_id.is_none() {
        return issue_form_page(&client, &project, None, &values, &session, &assignee_is_unknown(), StatusCode::UNPROCESSABLE_ENTITY).await;
    }
    let number = insert_issue(&mut client, &project, &session, &fields_of(values, assignee_id), Some("The issue was created.")).await?;
    Ok(see_other(&format!("/p/{}/issues/{number}", project.slug)))
}

pub async fn edit_issue_page(State(app): State<Arc<App>>, Path((project, number)): Path<(String, String)>, headers: HeaderMap) -> Answer {
    let client = app.pool.get().await?;
    let (session, found) = tokio::try_join!(find_session(&client, session_cookie(&headers)), find_issue(&client, &project, positive_integer(&number)))?;
    let Some((project, issue)) = found else { return Ok(not_found_page(session.as_ref())) };
    let Some(session) = session else { return Ok(see_other("/login")) };
    if !may_edit(&session, &issue) {
        return Ok(forbidden(Some(&session), "Only the author of an issue can edit it."));
    }
    let labels = labels_of(&client, issue.id).await?;
    let values = IssueFormValues {
        title: issue.title,
        body: issue.body,
        priority: Some(i64::from(issue.priority)),
        labels: labels.into_iter().map(|label| label.name).collect(),
        assignee: issue.assignee.map_or_else(String::new, |assignee| assignee.login),
        state: Some(if issue.state == "closed" { "closed" } else { "open" }),
    };
    issue_form_page(&client, &project, Some(issue.number), &values, &session, &[], StatusCode::OK).await
}

pub async fn save_issue(State(app): State<Arc<App>>, Path((project, number)): Path<(String, String)>, headers: HeaderMap, body: Bytes) -> Answer {
    let mut client = app.pool.get().await?;
    let form = Form::of(&body);
    let session = match signed(&client, &headers, &form).await? {
        Ok(session) => session,
        Err(answer) => return Ok(answer),
    };
    let Some((project, issue)) = find_issue(&client, &project, positive_integer(&number)).await? else { return Ok(not_found_page(Some(&session))) };
    if !may_edit(&session, &issue) {
        return Ok(forbidden(Some(&session), "Only the author of an issue can edit it."));
    }
    let (values, input) = issue_values(&form, true);
    let refusal = input.check(false);
    if !refusal.invalid.is_empty() {
        return issue_form_page(&client, &project, Some(issue.number), &values, &session, &refusal.invalid, StatusCode::UNPROCESSABLE_ENTITY).await;
    }
    let assignee_id = if values.assignee.is_empty() { None } else { find_user_id(&client, &values.assignee).await? };
    if !values.assignee.is_empty() && assignee_id.is_none() {
        return issue_form_page(&client, &project, Some(issue.number), &values, &session, &assignee_is_unknown(), StatusCode::UNPROCESSABLE_ENTITY).await;
    }
    let state = values.state.unwrap_or("open");
    update_issue(&mut client, &project, &issue, &session, &fields_of(values, assignee_id), state, Some("The issue was saved.")).await?;
    Ok(see_other(&format!("/p/{}/issues/{}", project.slug, issue.number)))
}

pub async fn create_comment(State(app): State<Arc<App>>, Path((project, number)): Path<(String, String)>, headers: HeaderMap, body: Bytes) -> Answer {
    let mut client = app.pool.get().await?;
    let form = Form::of(&body);
    let session = match signed(&client, &headers, &form).await? {
        Ok(session) => session,
        Err(answer) => return Ok(answer),
    };
    let Some((project, issue)) = find_issue(&client, &project, positive_integer(&number)).await? else { return Ok(not_found_page(Some(&session))) };

    let parent = form.field("parent_id");
    let input = CommentInput { body: Some(Some(form.text("body"))), parent_id: (!parent.is_empty()).then(|| parent.parse().ok()) };
    let mut valid = input.parent_id != Some(None) && input.check().invalid.is_empty();
    let parent_id = input.parent_id.flatten().map(|id| id as i32);
    if let (true, Some(parent_id)) = (valid, parent_id) {
        valid = comment_belongs_to(&client, parent_id, issue.id).await?;
    }
    if !valid {
        let message = "A comment must have 1 to 20,000 characters and answer a comment of the same issue.";
        return Ok(html(StatusCode::UNPROCESSABLE_ENTITY, error_page(Some(&session), "The comment was not saved", message)));
    }
    let text = input.body.flatten().unwrap_or_default();
    let (id, _) = insert_comment(&mut client, &issue, &session, &text, parent_id, Some("Your comment was added.")).await?;
    Ok(see_other(&format!("/p/{}/issues/{}#comment-{id}", project.slug, issue.number)))
}

pub async fn login_page(State(app): State<Arc<App>>, headers: HeaderMap) -> Answer {
    let client = app.pool.get().await?;
    if find_session(&client, session_cookie(&headers)).await?.is_some() {
        return Ok(see_other("/"));
    }
    Ok(html(StatusCode::OK, layout("Sign in", None, "", |out| login_view(out, "", &[]))))
}

const THIRTY_DAYS: i64 = 30 * 24 * 60 * 60;

pub async fn login(State(app): State<Arc<App>>, body: Bytes) -> Answer {
    let client = app.pool.get().await?;
    let form = Form::of(&body);
    let (name, password) = (form.field("login").trim(), form.field("password").to_string());
    let mut user_id = None;
    if is_login(name) && (1..=200).contains(&utf16_length(&password)) {
        if let Some(stored) = find_password(&client, name).await? {
            if tokio::task::spawn_blocking(move || password_matches(&password, &stored.salt, &stored.hash)).await? {
                user_id = Some(stored.user_id);
            }
        }
    }
    let Some(user_id) = user_id else {
        return Ok(html(StatusCode::UNAUTHORIZED, layout("Sign in", None, "", |out| login_view(out, name, &["login".to_string()]))));
    };
    let token = random_token(32);
    let insert = client
        .prepare_cached(
            "INSERT INTO sessions (token, user_id, csrf_token, expires_at)
             VALUES ($1, $2, $3, now() + $4 * interval '1 second')",
        )
        .await?;
    client.execute(&insert, &[&token, &user_id, &random_token(16), &(THIRTY_DAYS as f64)]).await?;
    let cookie = format!("sid={token}; Path=/; Max-Age={THIRTY_DAYS}; HttpOnly; SameSite=Lax");
    Ok((StatusCode::SEE_OTHER, [(header::LOCATION, "/".to_string()), (header::SET_COOKIE, cookie)]).into_response())
}

pub async fn logout(State(app): State<Arc<App>>, headers: HeaderMap, body: Bytes) -> Answer {
    let client = app.pool.get().await?;
    let session = match signed(&client, &headers, &Form::of(&body)).await? {
        Ok(session) => session,
        Err(answer) => return Ok(answer),
    };
    let delete = client.prepare_cached("DELETE FROM sessions WHERE token = $1").await?;
    client.execute(&delete, &[&session.token]).await?;
    Ok((StatusCode::SEE_OTHER, [(header::LOCATION, "/"), (header::SET_COOKIE, "sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax")]).into_response())
}

// The rest of the API.

#[derive(Serialize)]
struct ProjectsAnswer {
    projects: Vec<ProjectSummary>,
}

pub async fn api_projects(State(app): State<Arc<App>>) -> Answer {
    let client = app.pool.get().await?;
    json(StatusCode::OK, &ProjectsAnswer { projects: list_projects(&client).await? })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HitAnswer<'a> {
    project: &'a ProjectRef,
    number: i32,
    title: &'a str,
    state: &'a str,
    created_at: Timestamp,
    author: &'a UserRef,
    comment_count: i32,
    summary: String,
}

#[derive(Serialize)]
struct SearchAnswer<'a> {
    query: &'a str,
    page: i64,
    total: i32,
    hits: Vec<HitAnswer<'a>>,
}

pub async fn api_search(State(app): State<Arc<App>>, RawQuery(query): RawQuery) -> Answer {
    let (text, page) = search_words(query.as_deref());
    if text.is_empty() {
        return problem(StatusCode::BAD_REQUEST, "q is missing");
    }
    let client = app.pool.get().await?;
    let (hits, total) = tokio::try_join!(search_issues(&client, &text, 20, (page - 1) * 20), count_hits(&client, &text))?;
    let hits = hits
        .iter()
        .map(|SearchHit { issue, body, comment_count }| HitAnswer {
            project: &issue.project,
            number: issue.number,
            title: &issue.title,
            state: &issue.state,
            created_at: issue.created_at,
            author: &issue.author,
            comment_count: *comment_count,
            summary: summary(body, 30),
        })
        .collect();
    json(StatusCode::OK, &SearchAnswer { query: &text, page, total, hits })
}

pub async fn api_user(State(app): State<Arc<App>>, Path(login): Path<String>) -> Answer {
    let client = app.pool.get().await?;
    match load_profile(&client, &login).await? {
        Some(profile) => json(StatusCode::OK, &profile),
        None => problem(StatusCode::NOT_FOUND, "no such user"),
    }
}

pub async fn api_admin_stats(State(app): State<Arc<App>>, headers: HeaderMap) -> Answer {
    let client = app.pool.get().await?;
    let Some(session) = find_session(&client, bearer(&headers)).await? else { return problem(StatusCode::UNAUTHORIZED, "not signed in") };
    if session.user.role != "admin" {
        return problem(StatusCode::FORBIDDEN, "for administrators");
    }
    json(StatusCode::OK, &admin_stats(&client).await?)
}

#[derive(Serialize)]
struct InvalidAnswer<'a> {
    error: &'a str,
    fields: &'a [String],
}

fn refuse(refusal: &Refusal) -> Answer {
    if refusal.malformed {
        problem(StatusCode::BAD_REQUEST, "malformed")
    } else {
        json(StatusCode::UNPROCESSABLE_ENTITY, &InvalidAnswer { error: "invalid", fields: &refusal.invalid })
    }
}

#[derive(Serialize)]
struct MadeAnswer {
    number: i32,
    url: String,
}

fn made(project: &Project, number: i32) -> MadeAnswer {
    MadeAnswer { number, url: format!("/api/projects/{}/issues/{number}", project.slug) }
}

pub async fn api_create_issue(State(app): State<Arc<App>>, Path(project): Path<String>, headers: HeaderMap, body: Bytes) -> Answer {
    let mut client = app.pool.get().await?;
    let (session, project) = tokio::try_join!(find_session(&client, bearer(&headers)), find_project(&client, &project))?;
    let Some(session) = session else { return problem(StatusCode::UNAUTHORIZED, "not signed in") };
    let Some(project) = project else { return problem(StatusCode::NOT_FOUND, "no such project") };
    let Some(input) = object_of::<IssueInput>(&body) else { return refuse(&Refusal::malformed()) };
    let refusal = input.check(true);
    if !refusal.invalid.is_empty() {
        return refuse(&refusal);
    }
    let labels = input.label_names().unwrap_or_default();
    let assignee_id = match &input.assignee {
        Some(Some(assignee)) => match find_user_id(&client, assignee).await? {
            Some(id) => Some(id),
            None => return refuse(&Refusal::of("assignee")),
        },
        _ => None,
    };
    let fields = IssueFields {
        title: input.title.flatten().unwrap_or_default(),
        body: input.body.flatten().unwrap_or_default(),
        priority: input.priority.flatten().unwrap_or(0) as i32,
        labels,
        assignee_id,
    };
    let number = insert_issue(&mut client, &project, &session, &fields, None).await?;
    json(StatusCode::CREATED, &made(&project, number))
}

pub async fn api_update_issue(State(app): State<Arc<App>>, Path((project, number)): Path<(String, String)>, headers: HeaderMap, body: Bytes) -> Answer {
    let mut client = app.pool.get().await?;
    let (session, found) = tokio::try_join!(find_session(&client, bearer(&headers)), find_issue(&client, &project, positive_integer(&number)))?;
    let Some(session) = session else { return problem(StatusCode::UNAUTHORIZED, "not signed in") };
    let Some((project, issue)) = found else { return problem(StatusCode::NOT_FOUND, "no such issue") };
    if !may_edit(&session, &issue) {
        return problem(StatusCode::FORBIDDEN, "not your issue");
    }
    let Some(input) = object_of::<IssueInput>(&body) else { return refuse(&Refusal::malformed()) };
    let refusal = input.check(false);
    if !refusal.invalid.is_empty() {
        return refuse(&refusal);
    }

    let assignee = match &input.assignee {
        Some(assignee) => assignee.clone(),
        None => issue.assignee.as_ref().map(|assignee| assignee.login.clone()),
    };
    let given_labels = input.label_names();
    let (assignee_id, labels) = tokio::try_join!(
        async {
            match &assignee {
                Some(assignee) => find_user_id(&client, assignee).await,
                None => Ok(None),
            }
        },
        async {
            match given_labels {
                Some(labels) => Ok(labels),
                None => Ok(labels_of(&client, issue.id).await?.into_iter().map(|label| label.name).collect()),
            }
        }
    )?;
    if assignee.is_some() && assignee_id.is_none() {
        return refuse(&Refusal::of("assignee"));
    }
    let fields = IssueFields {
        title: input.title.flatten().unwrap_or_else(|| issue.title.clone()),
        body: input.body.flatten().unwrap_or_else(|| issue.body.clone()),
        priority: input.priority.flatten().map_or(issue.priority, |priority| priority as i32),
        labels,
        assignee_id,
    };
    let state = input.state.flatten().unwrap_or_else(|| issue.state.clone());
    update_issue(&mut client, &project, &issue, &session, &fields, &state, None).await?;
    json(StatusCode::OK, &made(&project, issue.number))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommentAnswer<'a> {
    id: i32,
    parent_id: Option<i32>,
    author: UserRef,
    body: &'a str,
    created_at: Timestamp,
}

pub async fn api_create_comment(State(app): State<Arc<App>>, Path((project, number)): Path<(String, String)>, headers: HeaderMap, body: Bytes) -> Answer {
    let mut client = app.pool.get().await?;
    let (session, found) = tokio::try_join!(find_session(&client, bearer(&headers)), find_issue(&client, &project, positive_integer(&number)))?;
    let Some(session) = session else { return problem(StatusCode::UNAUTHORIZED, "not signed in") };
    let Some((_, issue)) = found else { return problem(StatusCode::NOT_FOUND, "no such issue") };
    let Some(input) = object_of::<CommentInput>(&body) else { return refuse(&Refusal::malformed()) };
    let refusal = input.check();
    if !refusal.invalid.is_empty() {
        return refuse(&refusal);
    }
    let parent_id = input.parent_id.flatten().map(|id| id as i32);
    if let Some(parent_id) = parent_id {
        if !comment_belongs_to(&client, parent_id, issue.id).await? {
            return refuse(&Refusal::of("parentId"));
        }
    }
    let text = input.body.flatten().unwrap_or_default();
    let (id, created_at) = insert_comment(&mut client, &issue, &session, &text, parent_id, None).await?;
    let author = UserRef { login: session.user.login, name: session.user.name };
    json(StatusCode::CREATED, &CommentAnswer { id, parent_id, author, body: &text, created_at })
}
