//! Every function appends to the page, which is written from beginning to end into one String.

use crate::excerpt::{push_marked_excerpt, summary};
use crate::filters::{issue_list_url, IssueFilters};
use crate::format::*;
use crate::markdown::render_markdown;
use crate::types::*;

const PRIORITY_NAMES: [&str; 4] = ["low", "normal", "high", "urgent"];

fn push_account(out: &mut String, session: Option<&Session>) {
    let Some(session) = session else {
        out.push_str(r#"<a href="/login">Sign in</a>"#);
        return;
    };
    if session.user.role == "admin" {
        out.push_str(r#"<a href="/admin">Admin</a> "#);
    }
    out.push_str(r#"<a href="/u/"#);
    out.push_str(&session.user.login);
    wrapped(out, "\">", &session.user.name, "</a>\n");
    out.push_str(r#"<form method="post" action="/logout"><input type="hidden" name="csrf" value=""#);
    out.push_str(&session.csrf_token);
    out.push_str(r#""><button>Sign out</button></form>"#);
}

pub fn layout(title: &str, session: Option<&Session>, search_text: &str, content: impl FnOnce(&mut String)) -> String {
    let mut page = String::with_capacity(16 * 1024);
    let out = &mut page;
    out.push_str(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>"#,
    );
    escape(out, title);
    out.push_str(
        r#" · Tracker</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header class="site">
<a class="brand" href="/">Tracker</a>
<form class="search" action="/search"><input type="search" name="q" placeholder="Search issues" value=""#,
    );
    escape(out, search_text);
    out.push_str("\"></form>\n<nav>");
    push_account(out, session);
    out.push_str("</nav>\n</header>\n");
    if let Some(flash) = session.and_then(|session| session.flash.as_deref()).filter(|flash| !flash.is_empty()) {
        wrapped(out, r#"<p class="flash">"#, flash, "</p>\n");
    }
    out.push_str("<main>\n");
    content(out);
    out.push_str(
        r#"
</main>
<footer>Tracker, a program for measuring. <a href="/api/projects">API</a></footer>
</body>
</html>
"#,
    );
    page
}

fn push_user_link(out: &mut String, login: &str, name: &str) {
    out.push_str(r#"<a class="user" href="/u/"#);
    out.push_str(login);
    wrapped(out, "\">", name, "</a>");
}

fn push_label_chip(out: &mut String, label: &Label) {
    out.push_str(r#"<span class="label" style="background:#"#);
    out.push_str(&label.color);
    wrapped(out, "\">", &label.name, "</span>");
}

fn push_label_chips(out: &mut String, labels: &[Label]) {
    for (i, label) in labels.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        push_label_chip(out, label);
    }
}

fn push_selected(out: &mut String, yes: bool) {
    if yes {
        out.push_str(r#" class="selected""#);
    }
}

pub fn error_page(session: Option<&Session>, title: &str, message: &str) -> String {
    layout(title, session, "", |out| {
        wrapped(out, "<h1>", title, "</h1>\n");
        wrapped(out, "<p>", message, "</p>");
    })
}

const SORTS: [(&str, &str); 3] = [("updated", "Recently updated"), ("created", "Newest"), ("comments", "Most commented")];

fn push_issue_item(out: &mut String, project: &Project, issue: &IssueSummary) {
    out.push_str(r#"<li class="issue "#);
    out.push_str(&issue.state);
    out.push_str(" priority-");
    out.push_str(PRIORITY_NAMES[issue.priority as usize]);
    out.push_str("\">\n<a class=\"title\" href=\"/p/");
    out.push_str(&project.slug);
    out.push_str("/issues/");
    push_int(out, issue.number);
    wrapped(out, "\">", &issue.title, "</a> ");
    push_label_chips(out, &issue.labels);
    out.push_str("\n<div class=\"meta\">#");
    push_int(out, issue.number);
    out.push_str(" opened ");
    push_time_tag(out, issue.created_at, push_day);
    out.push_str(" by ");
    push_user_link(out, &issue.author.login, &issue.author.name);
    if let Some(assignee) = &issue.assignee {
        out.push_str(", assigned to ");
        push_user_link(out, &assignee.login, &assignee.name);
    }
    out.push_str(", updated ");
    push_time_tag(out, issue.updated_at, push_day);
    if issue.comment_count > 0 {
        out.push_str(", ");
        push_count(out, issue.comment_count as usize, "comment");
    }
    out.push_str("</div>\n</li>");
}

/// 1 2 3 .. 9 [10] 11 .. 40: the first, the last, and two on either side of the current page.
pub fn push_pagination(out: &mut String, current: i64, pages: i64, url_of_page: impl Fn(i64) -> String) {
    if pages <= 1 {
        return;
    }
    out.push_str(r#"<nav class="pagination">"#);
    if current > 1 {
        wrapped(out, r#"<a rel="prev" href=""#, &url_of_page(current - 1), "\">Previous</a> ");
    }
    let mut last = 0;
    for n in 1..=pages {
        if n != 1 && n != pages && (n - current).abs() > 2 {
            continue;
        }
        if last > 0 {
            out.push(' ');
        }
        if n - last > 1 {
            out.push_str(r#"<span class="gap">&hellip;</span> "#);
        }
        if n == current {
            out.push_str("<em>");
            push_int(out, n);
            out.push_str("</em>");
        } else {
            wrapped(out, "<a href=\"", &url_of_page(n), "\">");
            push_int(out, n);
            out.push_str("</a>");
        }
        last = n;
    }
    if current < pages {
        wrapped(out, r#" <a rel="next" href=""#, &url_of_page(current + 1), "\">Next</a>");
    }
    out.push_str("</nav>");
}

pub fn issue_list_view(
    out: &mut String,
    project: &Project,
    filters: &IssueFilters,
    issues: &[IssueSummary],
    counts: &StateCounts,
    labels: &[LabelCount],
    signed_in: bool,
) {
    let chosen_label = filters.label.as_deref();
    let link = |out: &mut String, selected: bool, state: &str, label: Option<&str>, sort: &str| {
        out.push_str("<a");
        push_selected(out, selected);
        wrapped(out, " href=\"", &issue_list_url(&project.slug, state, label, sort, 1), "\">");
    };
    let pages = (i64::from(counts.of(filters.state)) + filters.per_page - 1) / filters.per_page;
    wrapped(out, r#"<nav class="breadcrumb"><a href="/">Projects</a> / "#, &project.name, "</nav>\n");
    wrapped(out, "<h1>", &project.name, "</h1>\n");
    wrapped(out, r#"<p class="description">"#, &project.description, "</p>\n");
    if signed_in {
        out.push_str(r#"<p><a class="button" href="/p/"#);
        out.push_str(&project.slug);
        out.push_str("/issues/new\">New issue</a></p>\n");
    }
    out.push_str("<div class=\"columns\">\n<section>\n<div class=\"tabs\">");
    link(out, filters.state == "open", "open", chosen_label, filters.sort);
    push_number(out, counts.open as usize);
    out.push_str(" open</a> ");
    link(out, filters.state == "closed", "closed", chosen_label, filters.sort);
    push_number(out, counts.closed as usize);
    out.push_str(" closed</a></div>\n<div class=\"sorts\">");
    for (i, (sort, name)) in SORTS.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        link(out, filters.sort == *sort, filters.state, chosen_label, sort);
        out.push_str(name);
        out.push_str("</a>");
    }
    out.push_str("</div>\n");
    if issues.is_empty() {
        out.push_str(r#"<p class="empty">No issues match.</p>"#);
    } else {
        out.push_str(r#"<ul class="issues">"#);
        for issue in issues {
            out.push('\n');
            push_issue_item(out, project, issue);
        }
        out.push_str("\n</ul>");
    }
    out.push('\n');
    push_pagination(out, filters.page, pages, |page| issue_list_url(&project.slug, filters.state, chosen_label, filters.sort, page));
    out.push_str("\n</section>\n<aside>\n<h2>Labels</h2>\n<ul class=\"labels\">\n");
    for (i, LabelCount { label, open_issues }) in labels.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let chosen = chosen_label == Some(label.name.as_str());
        out.push_str("<li");
        push_selected(out, chosen);
        out.push('>');
        link(out, false, filters.state, if chosen { None } else { Some(&label.name) }, filters.sort);
        push_label_chip(out, label);
        out.push_str(r#"</a> <span class="count">"#);
        push_number(out, *open_issues as usize);
        out.push_str("</span></li>");
    }
    out.push_str("\n</ul>\n</aside>\n</div>");
}

const DEEPEST_INDENT: usize = 6;

fn push_comment(out: &mut String, project: &Project, issue: &Issue, comment: &Comment, depth: usize, signed_in: bool) {
    out.push_str(r#"<article class="comment" id="comment-"#);
    push_int(out, comment.id);
    out.push_str("\">\n<header>");
    push_user_link(out, &comment.author.login, &comment.author.name);
    if comment.author.login == issue.author.login {
        out.push_str(r#" <span class="badge">Author</span>"#);
    }
    out.push_str(r##" <a class="permalink" href="#comment-"##);
    push_int(out, comment.id);
    out.push_str("\">");
    push_time_tag(out, comment.created_at, push_minute);
    out.push_str("</a>");
    if let Some(edited_at) = comment.edited_at {
        out.push_str(r#" <span class="edited">edited "#);
        push_time_tag(out, edited_at, push_day);
        out.push_str("</span>");
    }
    out.push_str("</header>\n<div class=\"markdown\">\n");
    render_markdown(out, &comment.body, &project.slug);
    out.push_str("</div>\n");
    if signed_in {
        out.push_str(r#"<a class="reply" href="?reply_to="#);
        push_int(out, comment.id);
        out.push_str("#reply\">Reply</a>\n");
    }
    if !comment.replies.is_empty() {
        if depth < DEEPEST_INDENT {
            out.push_str("<div class=\"replies\">\n");
        }
        for (i, reply) in comment.replies.iter().enumerate() {
            if i > 0 {
                out.push('\n');
            }
            push_comment(out, project, issue, reply, depth + 1, signed_in);
        }
        out.push_str(if depth < DEEPEST_INDENT { "\n</div>\n" } else { "\n" });
    }
    out.push_str("</article>");
}

fn push_comment_form(out: &mut String, project: &Project, issue: &Issue, session: &Session, reply_to: Option<i32>) {
    out.push_str(r#"<form id="reply" method="post" action="/p/"#);
    out.push_str(&project.slug);
    out.push_str("/issues/");
    push_int(out, issue.number);
    out.push_str("/comments\">\n<input type=\"hidden\" name=\"csrf\" value=\"");
    out.push_str(&session.csrf_token);
    out.push_str("\">\n");
    if let Some(reply_to) = reply_to {
        out.push_str(r#"<input type="hidden" name="parent_id" value=""#);
        push_int(out, reply_to);
        out.push_str("\">\n<p>Replying to <a href=\"#comment-");
        push_int(out, reply_to);
        out.push_str("\">a comment</a>.</p>\n");
    }
    out.push_str(
        r#"<textarea name="body" rows="6" required maxlength="20000" placeholder="Leave a comment"></textarea>
<button>Comment</button>
</form>"#,
    );
}

pub fn issue_page_view(
    out: &mut String,
    project: &Project,
    issue: &Issue,
    thread: &[Comment],
    participants: &[Participant],
    session: Option<&Session>,
    reply_to: Option<i32>,
) {
    out.push_str(r#"<nav class="breadcrumb"><a href="/">Projects</a> / <a href="/p/"#);
    out.push_str(&project.slug);
    wrapped(out, "/issues\">", &project.name, "</a> / #");
    push_int(out, issue.number);
    wrapped(out, "</nav>\n<h1>", &issue.title, r#" <span class="number">#"#);
    push_int(out, issue.number);
    out.push_str("</span></h1>\n<p class=\"meta\"><span class=\"state ");
    out.push_str(&issue.state);
    out.push_str(if issue.state == "open" { "\">Open</span> " } else { "\">Closed</span> " });
    push_user_link(out, &issue.author.login, &issue.author.name);
    out.push_str(" opened this issue on ");
    push_time_tag(out, issue.created_at, push_day);
    out.push_str(", ");
    push_count(out, issue.comment_count as usize, "comment");
    if let Some(closed_at) = issue.closed_at {
        out.push_str(", closed on ");
        push_time_tag(out, closed_at, push_day);
    }
    out.push_str("</p>\n<div class=\"columns\">\n<section>\n<div class=\"markdown\">\n");
    render_markdown(out, &issue.body, &project.slug);
    out.push_str("</div>\n");
    for (i, comment) in thread.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        push_comment(out, project, issue, comment, 0, session.is_some());
    }
    out.push('\n');
    match session {
        Some(session) => push_comment_form(out, project, issue, session, reply_to),
        None => out.push_str(r#"<p><a href="/login">Sign in</a> to comment.</p>"#),
    }
    let priority = PRIORITY_NAMES[issue.priority as usize];
    out.push_str("\n</section>\n<aside>\n<h2>Priority</h2>\n<p class=\"priority-");
    out.push_str(priority);
    out.push_str("\">");
    out.push_str(priority);
    out.push_str("</p>\n<h2>Assignee</h2>\n<p>");
    match &issue.assignee {
        Some(assignee) => push_user_link(out, &assignee.login, &assignee.name),
        None => out.push_str("No one"),
    }
    out.push_str("</p>\n<h2>Labels</h2>\n<p>");
    if issue.labels.is_empty() {
        out.push_str("None");
    } else {
        push_label_chips(out, &issue.labels);
    }
    out.push_str("</p>\n<h2>");
    push_count(out, participants.len(), "participant");
    out.push_str("</h2>\n<ul class=\"participants\">\n");
    for (i, participant) in participants.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str("<li>");
        push_user_link(out, &participant.login, &participant.name);
        out.push_str(r#" <span class="count">"#);
        push_int(out, participant.comments);
        out.push_str("</span></li>");
    }
    out.push_str("\n</ul>\n");
    if session.is_some_and(|session| session.user.login == issue.author.login || session.user.role == "admin") {
        out.push_str(r#"<p><a class="button" href="/p/"#);
        out.push_str(&project.slug);
        out.push_str("/issues/");
        push_int(out, issue.number);
        out.push_str("/edit\">Edit</a></p>\n");
    }
    out.push_str("</aside>\n</div>");
}

fn push_issue_mention(out: &mut String, issue: &IssueMention) {
    out.push_str(r#"<li class="issue "#);
    out.push_str(&issue.state);
    out.push_str(r#""><a class="title" href="/p/"#);
    out.push_str(&issue.project.slug);
    out.push_str("/issues/");
    push_int(out, issue.number);
    wrapped(out, "\">", &issue.title, "</a>\n");
}

fn push_mention_meta(out: &mut String, issue: &IssueMention) {
    out.push_str(r#"<div class="meta"><a href="/p/"#);
    out.push_str(&issue.project.slug);
    wrapped(out, "/issues\">", &issue.project.name, "</a> #");
    push_int(out, issue.number);
    out.push_str(" opened ");
    push_time_tag(out, issue.created_at, push_day);
    out.push_str(" by ");
    push_user_link(out, &issue.author.login, &issue.author.name);
}

fn push_issue_mentions(out: &mut String, issues: &[IssueMention]) {
    for (i, issue) in issues.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        push_issue_mention(out, issue);
        push_mention_meta(out, issue);
        out.push_str("</div></li>");
    }
}

pub fn home_view(out: &mut String, projects: &[ProjectSummary], newest: &[IssueMention]) {
    out.push_str("<h1>Projects</h1>\n<ul class=\"projects\">\n");
    for (i, project) in projects.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(r#"<li><a href="/p/"#);
        out.push_str(&project.slug);
        wrapped(out, "/issues\">", &project.name, r#"</a> <span class="count">"#);
        push_number(out, project.open_issues as usize);
        out.push_str(" open, ");
        push_number(out, project.closed_issues as usize);
        wrapped(out, " closed</span>\n<p>", &project.description, "</p></li>");
    }
    out.push_str("\n</ul>\n<h2>Newest issues</h2>\n<ul class=\"issues\">\n");
    push_issue_mentions(out, newest);
    out.push_str("\n</ul>");
}

fn search_url(text: &str, page: i64) -> String {
    let mut address = String::from("/search?q=");
    address.extend(form_urlencoded::byte_serialize(text.as_bytes()));
    if page != 1 {
        address.push_str("&page=");
        push_int(&mut address, page);
    }
    address
}

pub fn search_view(out: &mut String, text: &str, terms: &[String], hits: &[SearchHit], total: i64, page: i64, per_page: i64) {
    if text.is_empty() {
        out.push_str("<h1>Search</h1>\n<p>Type some words into the box above.</p>");
        return;
    }
    out.push_str("<h1>");
    push_count(out, total as usize, "issue");
    wrapped(out, " for “", text, "”</h1>\n");
    if hits.is_empty() {
        out.push_str(r#"<p class="empty">Nothing here.</p>"#);
    } else {
        out.push_str(r#"<ul class="hits">"#);
        for hit in hits {
            out.push('\n');
            push_issue_mention(out, &hit.issue);
            out.push_str("<p>");
            push_marked_excerpt(out, &hit.body, terms);
            out.push_str("</p>\n");
            push_mention_meta(out, &hit.issue);
            out.push_str(", ");
            push_count(out, hit.comment_count as usize, "comment");
            out.push_str("</div></li>");
        }
        out.push_str("\n</ul>");
    }
    out.push('\n');
    push_pagination(out, page, (total + per_page - 1) / per_page, |page| search_url(text, page));
}

pub fn profile_view(out: &mut String, profile: &Profile) {
    let user = &profile.user;
    wrapped(out, "<h1>", &user.name, r#" <span class="login">@"#);
    out.push_str(&user.login);
    out.push_str("</span>");
    if user.role == "admin" {
        out.push_str(r#" <span class="badge">Admin</span>"#);
    }
    wrapped(out, "</h1>\n<p class=\"bio\">", &user.bio, "</p>\n<p class=\"meta\">Joined ");
    push_time_tag(out, user.created_at, push_day);
    out.push_str(", ");
    push_count(out, profile.issue_count as usize, "issue");
    out.push_str(", ");
    push_count(out, profile.comment_count as usize, "comment");
    out.push_str("</p>\n<h2>Newest issues</h2>\n");
    if profile.issues.is_empty() {
        out.push_str(r#"<p class="empty">None yet.</p>"#);
    } else {
        out.push_str("<ul class=\"issues\">\n");
        push_issue_mentions(out, &profile.issues);
        out.push_str("\n</ul>");
    }
    out.push_str("\n<h2>Newest comments</h2>\n");
    if profile.comments.is_empty() {
        out.push_str(r#"<p class="empty">None yet.</p>"#);
        return;
    }
    out.push_str(r#"<ul class="comments">"#);
    for comment in &profile.comments {
        out.push_str("\n<li><a href=\"/p/");
        out.push_str(&comment.project.slug);
        out.push_str("/issues/");
        push_int(out, comment.issue.number);
        out.push_str("#comment-");
        push_int(out, comment.id);
        wrapped(out, "\">", &comment.issue.title, r#"</a> <span class="meta">"#);
        escape(out, &comment.project.name);
        out.push_str(" #");
        push_int(out, comment.issue.number);
        out.push_str(", ");
        push_time_tag(out, comment.created_at, push_day);
        wrapped(out, "</span>\n<p>", &summary(&comment.body, 24), "</p></li>");
    }
    out.push_str("\n</ul>");
}

fn push_duration(out: &mut String, minutes: i32) {
    let (days, hours) = (minutes / 1440, minutes % 1440 / 60);
    if days > 0 {
        push_number(out, days as usize);
        out.push_str(" d ");
        push_int(out, hours);
        out.push_str(" h");
    } else {
        push_int(out, hours);
        out.push_str(" h ");
        push_int(out, minutes % 60);
        out.push_str(" min");
    }
}

fn push_bar(out: &mut String, kind: &str, x: usize, count: i32, most: i32) {
    let height = count * 120 / most;
    out.push_str("<rect class=\"");
    out.push_str(kind);
    out.push_str("\" x=\"");
    push_int(out, x);
    out.push_str("\" y=\"");
    push_int(out, 120 - height);
    out.push_str("\" width=\"14\" height=\"");
    push_int(out, height);
    out.push_str("\"><title>");
    push_number(out, count as usize);
    out.push(' ');
    out.push_str(kind);
    out.push_str("</title></rect>");
}

/// Two bars a month: opened and closed.
fn push_chart(out: &mut String, months: &[MonthCount]) {
    let most = months.iter().map(|month| month.opened.max(month.closed)).max().unwrap_or(0).max(1);
    out.push_str("<svg class=\"chart\" viewBox=\"0 0 ");
    push_int(out, months.len() * 40);
    out.push_str(" 140\" width=\"");
    push_int(out, months.len() * 40);
    out.push_str("\" height=\"140\" role=\"img\">");
    for (i, month) in months.iter().enumerate() {
        out.push('\n');
        push_bar(out, "opened", i * 40 + 4, month.opened, most);
        push_bar(out, "closed", i * 40 + 20, month.closed, most);
        out.push_str("<text x=\"");
        push_int(out, i * 40 + 4);
        out.push_str("\" y=\"134\" font-size=\"9\">");
        out.push_str(&month.month[2..]);
        out.push_str("</text>");
    }
    out.push_str("\n</svg>");
}

pub fn admin_view(out: &mut String, stats: &AdminStats) {
    let totals = &stats.totals;
    out.push_str(
        "<h1>Admin</h1>\n<table>\n<tr><th>Users</th><th>Projects</th><th>Open issues</th><th>Closed issues</th><th>Comments</th></tr>\n<tr><td>",
    );
    push_number(out, totals.users as usize);
    for n in [totals.projects, totals.open_issues, totals.closed_issues, totals.comments] {
        out.push_str("</td><td>");
        push_number(out, n as usize);
    }
    out.push_str("</td></tr>\n</table>\n<h2>Opened and closed by month</h2>\n");
    push_chart(out, &stats.months);
    out.push_str("\n<table>\n<tr><th>Month</th><th>Opened</th><th>Closed</th><th>Net</th></tr>");
    for month in &stats.months {
        out.push_str("\n<tr><td>");
        out.push_str(&month.month);
        for n in [month.opened, month.closed, month.opened - month.closed] {
            out.push_str("</td><td>");
            push_signed_number(out, i64::from(n));
        }
        out.push_str("</td></tr>");
    }
    out.push_str("\n</table>\n<h2>By priority</h2>\n<table>\n<tr><th>Priority</th><th>Open</th><th>Mean time to close</th></tr>");
    for row in &stats.priorities {
        out.push_str("\n<tr><td>");
        out.push_str(PRIORITY_NAMES[row.priority as usize]);
        out.push_str("</td><td>");
        push_number(out, row.open as usize);
        out.push_str("</td><td>");
        push_duration(out, row.minutes_to_close);
        out.push_str("</td></tr>");
    }
    out.push_str("\n</table>\n<h2>Who comments most</h2>\n<ol>");
    for user in &stats.commenters {
        out.push_str("\n<li>");
        push_user_link(out, &user.login, &user.name);
        out.push_str(r#" <span class="count">"#);
        push_number(out, user.comments as usize);
        out.push_str("</span></li>");
    }
    out.push_str("\n</ol>\n<h2>Where most is said</h2>\n<ol>");
    for project in &stats.busiest {
        out.push_str("\n<li><a href=\"/p/");
        out.push_str(&project.slug);
        wrapped(out, "/issues\">", &project.name, r#"</a> <span class="count">"#);
        push_number(out, project.comments as usize);
        out.push_str("</span></li>");
    }
    out.push_str("\n</ol>");
}

fn message_of(field: &str) -> &'static str {
    match field {
        "title" => "The title must have 1 to 200 characters.",
        "body" => "The text must have at most 20,000 characters.",
        "priority" => "Choose a priority.",
        "labels" => "Choose at most 12 labels.",
        "assignee" => "There is no user with that login.",
        "state" => "An issue is open or closed.",
        "parentId" => "The comment that this answers is not part of this issue.",
        "login" => "The login or the password is wrong.",
        _ => "The form is not complete.",
    }
}

/// What is wrong with a form, for a person. `invalid` holds paths such as "title" or "labels.3".
fn push_error_list(out: &mut String, invalid: &[String]) {
    if invalid.is_empty() {
        return;
    }
    out.push_str(r#"<ul class="errors">"#);
    let mut seen: Vec<&str> = Vec::new();
    for path in invalid {
        let field = path.split('.').next().unwrap_or("");
        if seen.contains(&field) {
            continue;
        }
        seen.push(field);
        out.push_str("\n<li>");
        out.push_str(message_of(field));
        out.push_str("</li>");
    }
    out.push_str("\n</ul>\n");
}

#[derive(Default)]
pub struct IssueFormValues {
    pub title: String,
    pub body: String,
    pub priority: Option<i64>,
    pub labels: Vec<String>,
    pub assignee: String,
    pub state: Option<&'static str>,
}

fn push_option(out: &mut String, value: &str, name: &str, selected: bool) {
    out.push_str("<option value=\"");
    out.push_str(value);
    out.push_str(if selected { "\" selected>" } else { "\">" });
    out.push_str(name);
    out.push_str("</option>");
}

pub fn issue_form_view(out: &mut String, project: &Project, number: Option<i32>, values: &IssueFormValues, labels: &[Label], session: &Session, invalid: &[String]) {
    let issues = format!("/p/{}/issues", project.slug);
    out.push_str(r#"<nav class="breadcrumb"><a href="/">Projects</a> / <a href=""#);
    out.push_str(&issues);
    wrapped(out, "\">", &project.name, "</a> / ");
    match number {
        None => out.push_str("New issue</nav>\n<h1>New issue</h1>\n"),
        Some(number) => {
            out.push_str("<a href=\"");
            out.push_str(&issues);
            out.push('/');
            push_int(out, number);
            out.push_str("\">#");
            push_int(out, number);
            out.push_str("</a> / Edit</nav>\n<h1>Edit issue #");
            push_int(out, number);
            out.push_str("</h1>\n");
        }
    }
    push_error_list(out, invalid);
    out.push_str(r#"<form method="post" action=""#);
    out.push_str(&issues);
    if let Some(number) = number {
        out.push('/');
        push_int(out, number);
    }
    out.push_str("\">\n<input type=\"hidden\" name=\"csrf\" value=\"");
    out.push_str(&session.csrf_token);
    wrapped(
        out,
        "\">\n<label>Title <input name=\"title\" value=\"",
        &values.title,
        "\" required maxlength=\"200\"></label>\n<label>Text <textarea name=\"body\" rows=\"12\" maxlength=\"20000\">",
    );
    escape(out, &values.body);
    out.push_str("</textarea></label>\n<label>Priority <select name=\"priority\">");
    for (priority, name) in PRIORITY_NAMES.iter().enumerate() {
        push_option(out, itoa::Buffer::new().format(priority), name, values.priority == Some(priority as i64));
    }
    out.push_str("</select></label>\n");
    if let Some(state) = values.state {
        out.push_str(r#"<label>State <select name="state">"#);
        push_option(out, "open", "open", state == "open");
        push_option(out, "closed", "closed", state == "closed");
        out.push_str("</select></label>\n");
    }
    out.push_str("<fieldset><legend>Labels</legend>");
    for label in labels {
        wrapped(out, "\n<label><input type=\"checkbox\" name=\"labels\" value=\"", &label.name, "\"");
        if values.labels.contains(&label.name) {
            out.push_str(" checked");
        }
        wrapped(out, "> ", &label.name, "</label>");
    }
    wrapped(out, "\n</fieldset>\n<label>Assignee <input name=\"assignee\" value=\"", &values.assignee, "\" placeholder=\"login\"></label>\n<button>");
    out.push_str(if number.is_none() { "Create issue" } else { "Save" });
    out.push_str("</button>\n</form>");
}

pub fn login_view(out: &mut String, login: &str, invalid: &[String]) {
    out.push_str("<h1>Sign in</h1>\n");
    push_error_list(out, invalid);
    wrapped(
        out,
        "<form method=\"post\" action=\"/login\">\n<label>Login <input name=\"login\" value=\"",
        login,
        "\" required autocomplete=\"username\"></label>\n<label>Password <input type=\"password\" name=\"password\" required autocomplete=\"current-password\"></label>\n<button>Sign in</button>\n</form>",
    );
}
