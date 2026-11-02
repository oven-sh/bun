package main

import (
	"slices"
	"strconv"
	"strings"
)

var priorityNames = [...]string{"low", "normal", "high", "urgent"}

func writeAccount(w *page, s *session) {
	if s == nil {
		w.WriteString(`<a href="/login">Sign in</a>`)
		return
	}
	if s.User.Role == "admin" {
		w.WriteString(`<a href="/admin">Admin</a> `)
	}
	w.WriteString(`<a href="/u/`)
	w.WriteString(s.User.Login)
	w.WriteString(`">`)
	escape(w, s.User.Name)
	w.WriteString("</a>\n" + `<form method="post" action="/logout"><input type="hidden" name="csrf" value="`)
	w.WriteString(s.CSRFToken)
	w.WriteString(`"><button>Sign out</button></form>`)
}

func layout(w *page, title string, s *session, searchText string, content func(*page)) {
	w.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>`)
	escape(w, title)
	w.WriteString(` · Tracker</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header class="site">
<a class="brand" href="/">Tracker</a>
<form class="search" action="/search"><input type="search" name="q" placeholder="Search issues" value="`)
	escape(w, searchText)
	w.WriteString(`"></form>
<nav>`)
	writeAccount(w, s)
	w.WriteString(`</nav>
</header>
`)
	if s != nil && s.Flash != nil && *s.Flash != "" {
		wrapped(w, `<p class="flash">`, *s.Flash, "</p>\n")
	}
	w.WriteString("<main>\n")
	content(w)
	w.WriteString(`
</main>
<footer>Tracker, a program for measuring. <a href="/api/projects">API</a></footer>
</body>
</html>
`)
}

func writeUserLink(w *page, user *userRef) {
	w.WriteString(`<a class="user" href="/u/`)
	w.WriteString(user.Login)
	w.WriteString(`">`)
	escape(w, user.Name)
	w.WriteString(`</a>`)
}

func writeLabelChip(w *page, l *label) {
	w.WriteString(`<span class="label" style="background:#`)
	w.WriteString(l.Color)
	w.WriteString(`">`)
	escape(w, l.Name)
	w.WriteString(`</span>`)
}

func writeLabelChips(w *page, labels []label) {
	for i := range labels {
		if i > 0 {
			w.WriteByte(' ')
		}
		writeLabelChip(w, &labels[i])
	}
}

func writeSelected(w *page, yes bool) {
	if yes {
		w.WriteString(` class="selected"`)
	}
}

func errorPage(w *page, s *session, title, message string) {
	layout(w, title, s, "", func(w *page) {
		wrapped(w, "<h1>", title, "</h1>\n")
		wrapped(w, "<p>", message, "</p>")
	})
}

var sorts = [...][2]string{{"updated", "Recently updated"}, {"created", "Newest"}, {"comments", "Most commented"}}

func writeIssueItem(w *page, p *project, row *issueSummary) {
	w.WriteString(`<li class="issue `)
	w.WriteString(row.State)
	w.WriteString(` priority-`)
	w.WriteString(priorityNames[row.Priority])
	w.WriteString("\">\n" + `<a class="title" href="/p/`)
	w.WriteString(p.Slug)
	w.WriteString(`/issues/`)
	writeInt(w, int(row.Number))
	w.WriteString(`">`)
	escape(w, row.Title)
	w.WriteString(`</a> `)
	writeLabelChips(w, row.Labels)
	w.WriteString("\n" + `<div class="meta">#`)
	writeInt(w, int(row.Number))
	w.WriteString(` opened `)
	writeTimeTag(w, row.CreatedAt, writeDay)
	w.WriteString(` by `)
	writeUserLink(w, &row.Author)
	if row.Assignee != nil {
		w.WriteString(`, assigned to `)
		writeUserLink(w, row.Assignee)
	}
	w.WriteString(`, updated `)
	writeTimeTag(w, row.UpdatedAt, writeDay)
	if row.CommentCount > 0 {
		w.WriteString(`, `)
		writeCount(w, int(row.CommentCount), "comment")
	}
	w.WriteString("</div>\n</li>")
}

// 1 2 3 .. 9 [10] 11 .. 40: the first, the last, and two on either side of the current page.
func writePagination(w *page, current, pages int, urlOfPage func(int) string) {
	if pages <= 1 {
		return
	}
	w.WriteString(`<nav class="pagination">`)
	if current > 1 {
		wrapped(w, `<a rel="prev" href="`, urlOfPage(current-1), `">Previous</a> `)
	}
	last := 0
	for n := 1; n <= pages; n++ {
		if n != 1 && n != pages && (n-current > 2 || current-n > 2) {
			continue
		}
		if last > 0 {
			w.WriteByte(' ')
		}
		if n-last > 1 {
			w.WriteString(`<span class="gap">&hellip;</span> `)
		}
		if n == current {
			w.WriteString(`<em>`)
			writeInt(w, n)
			w.WriteString(`</em>`)
		} else {
			wrapped(w, `<a href="`, urlOfPage(n), `">`)
			writeInt(w, n)
			w.WriteString(`</a>`)
		}
		last = n
	}
	if current < pages {
		wrapped(w, ` <a rel="next" href="`, urlOfPage(current+1), `">Next</a>`)
	}
	w.WriteString(`</nav>`)
}

func issueListView(w *page, p *project, filters issueFilters, issues []issueSummary, counts stateCounts, labels []labelCount, signedIn bool) {
	link := func(selected bool, change func(*issueFilters)) {
		changed := filters
		changed.Page = 1
		change(&changed)
		w.WriteString(`<a`)
		writeSelected(w, selected)
		wrapped(w, ` href="`, issueListURL(p.Slug, changed), `">`)
	}
	pages := (int(counts.of(filters.State)) + filters.PerPage - 1) / filters.PerPage
	wrapped(w, `<nav class="breadcrumb"><a href="/">Projects</a> / `, p.Name, "</nav>\n")
	wrapped(w, `<h1>`, p.Name, "</h1>\n")
	wrapped(w, `<p class="description">`, p.Description, "</p>\n")
	if signedIn {
		w.WriteString(`<p><a class="button" href="/p/`)
		w.WriteString(p.Slug)
		w.WriteString(`/issues/new">New issue</a></p>` + "\n")
	}
	w.WriteString(`<div class="columns">
<section>
<div class="tabs">`)
	link(filters.State == "open", func(f *issueFilters) { f.State = "open" })
	writeNumber(w, int(counts.Open))
	w.WriteString(` open</a> `)
	link(filters.State == "closed", func(f *issueFilters) { f.State = "closed" })
	writeNumber(w, int(counts.Closed))
	w.WriteString(` closed</a></div>
<div class="sorts">`)
	for i, sort := range sorts {
		if i > 0 {
			w.WriteByte(' ')
		}
		link(filters.Sort == sort[0], func(f *issueFilters) { f.Sort = sort[0] })
		w.WriteString(sort[1])
		w.WriteString(`</a>`)
	}
	w.WriteString("</div>\n")
	if len(issues) == 0 {
		w.WriteString(`<p class="empty">No issues match.</p>`)
	} else {
		w.WriteString(`<ul class="issues">`)
		for i := range issues {
			w.WriteByte('\n')
			writeIssueItem(w, p, &issues[i])
		}
		w.WriteString("\n</ul>")
	}
	w.WriteByte('\n')
	writePagination(w, filters.Page, pages, func(n int) string {
		changed := filters
		changed.Page = n
		return issueListURL(p.Slug, changed)
	})
	w.WriteString(`
</section>
<aside>
<h2>Labels</h2>
<ul class="labels">
`)
	for i := range labels {
		l := &labels[i]
		if i > 0 {
			w.WriteByte('\n')
		}
		chosen := filters.Label != nil && *filters.Label == l.Name
		w.WriteString(`<li`)
		writeSelected(w, chosen)
		w.WriteByte('>')
		link(false, func(f *issueFilters) {
			if chosen {
				f.Label = nil
			} else {
				f.Label = &l.Name
			}
		})
		writeLabelChip(w, &l.label)
		w.WriteString(`</a> <span class="count">`)
		writeNumber(w, int(l.OpenIssues))
		w.WriteString(`</span></li>`)
	}
	w.WriteString(`
</ul>
</aside>
</div>`)
}

const deepestIndent = 6

func writeComment(w *page, p *project, i *issue, c *commentNode, depth int, s *session) {
	w.WriteString(`<article class="comment" id="comment-`)
	writeInt(w, int(c.ID))
	w.WriteString("\">\n<header>")
	writeUserLink(w, &c.Author)
	if c.Author.Login == i.Author.Login {
		w.WriteString(` <span class="badge">Author</span>`)
	}
	w.WriteString(` <a class="permalink" href="#comment-`)
	writeInt(w, int(c.ID))
	w.WriteString(`">`)
	writeTimeTag(w, c.CreatedAt, writeMinute)
	w.WriteString(`</a>`)
	if c.EditedAt != nil {
		w.WriteString(` <span class="edited">edited `)
		writeTimeTag(w, *c.EditedAt, writeDay)
		w.WriteString(`</span>`)
	}
	w.WriteString("</header>\n<div class=\"markdown\">\n")
	renderMarkdown(w, c.Body, p.Slug)
	w.WriteString("</div>\n")
	if s != nil {
		w.WriteString(`<a class="reply" href="?reply_to=`)
		writeInt(w, int(c.ID))
		w.WriteString(`#reply">Reply</a>` + "\n")
	}
	if len(c.Replies) > 0 {
		if depth < deepestIndent {
			w.WriteString("<div class=\"replies\">\n")
		}
		for n, reply := range c.Replies {
			if n > 0 {
				w.WriteByte('\n')
			}
			writeComment(w, p, i, reply, depth+1, s)
		}
		if depth < deepestIndent {
			w.WriteString("\n</div>\n")
		} else {
			w.WriteByte('\n')
		}
	}
	w.WriteString(`</article>`)
}

func writeCommentForm(w *page, p *project, i *issue, s *session, replyTo int32) {
	w.WriteString(`<form id="reply" method="post" action="/p/`)
	w.WriteString(p.Slug)
	w.WriteString(`/issues/`)
	writeInt(w, int(i.Number))
	w.WriteString(`/comments">
<input type="hidden" name="csrf" value="`)
	w.WriteString(s.CSRFToken)
	w.WriteString("\">\n")
	if replyTo != 0 {
		w.WriteString(`<input type="hidden" name="parent_id" value="`)
		writeInt(w, int(replyTo))
		w.WriteString("\">\n" + `<p>Replying to <a href="#comment-`)
		writeInt(w, int(replyTo))
		w.WriteString(`">a comment</a>.</p>` + "\n")
	}
	w.WriteString(`<textarea name="body" rows="6" required maxlength="20000" placeholder="Leave a comment"></textarea>
<button>Comment</button>
</form>`)
}

func issuePageView(w *page, p *project, i *issue, thread []*commentNode, participants []*participant, s *session, replyTo int32) {
	w.WriteString(`<nav class="breadcrumb"><a href="/">Projects</a> / <a href="/p/`)
	w.WriteString(p.Slug)
	wrapped(w, `/issues">`, p.Name, `</a> / #`)
	writeInt(w, int(i.Number))
	wrapped(w, "</nav>\n<h1>", i.Title, ` <span class="number">#`)
	writeInt(w, int(i.Number))
	w.WriteString("</span></h1>\n" + `<p class="meta"><span class="state `)
	w.WriteString(i.State)
	if i.State == "open" {
		w.WriteString(`">Open</span> `)
	} else {
		w.WriteString(`">Closed</span> `)
	}
	writeUserLink(w, &i.Author)
	w.WriteString(` opened this issue on `)
	writeTimeTag(w, i.CreatedAt, writeDay)
	w.WriteString(`, `)
	writeCount(w, int(i.CommentCount), "comment")
	if i.ClosedAt != nil {
		w.WriteString(`, closed on `)
		writeTimeTag(w, *i.ClosedAt, writeDay)
	}
	w.WriteString(`</p>
<div class="columns">
<section>
<div class="markdown">
`)
	renderMarkdown(w, i.Body, p.Slug)
	w.WriteString("</div>\n")
	for n, c := range thread {
		if n > 0 {
			w.WriteByte('\n')
		}
		writeComment(w, p, i, c, 0, s)
	}
	w.WriteByte('\n')
	if s != nil {
		writeCommentForm(w, p, i, s, replyTo)
	} else {
		w.WriteString(`<p><a href="/login">Sign in</a> to comment.</p>`)
	}
	w.WriteString(`
</section>
<aside>
<h2>Priority</h2>
<p class="priority-`)
	w.WriteString(priorityNames[i.Priority])
	w.WriteString(`">`)
	w.WriteString(priorityNames[i.Priority])
	w.WriteString(`</p>
<h2>Assignee</h2>
<p>`)
	if i.Assignee != nil {
		writeUserLink(w, i.Assignee)
	} else {
		w.WriteString(`No one`)
	}
	w.WriteString(`</p>
<h2>Labels</h2>
<p>`)
	if len(i.Labels) == 0 {
		w.WriteString(`None`)
	} else {
		writeLabelChips(w, i.Labels)
	}
	w.WriteString("</p>\n<h2>")
	writeCount(w, len(participants), "participant")
	w.WriteString(`</h2>
<ul class="participants">
`)
	for n, who := range participants {
		if n > 0 {
			w.WriteByte('\n')
		}
		w.WriteString(`<li>`)
		writeUserLink(w, &who.userRef)
		w.WriteString(` <span class="count">`)
		writeInt(w, who.Comments)
		w.WriteString(`</span></li>`)
	}
	w.WriteString("\n</ul>\n")
	if s != nil && (s.User.Login == i.Author.Login || s.User.Role == "admin") {
		w.WriteString(`<p><a class="button" href="/p/`)
		w.WriteString(p.Slug)
		w.WriteString(`/issues/`)
		writeInt(w, int(i.Number))
		w.WriteString(`/edit">Edit</a></p>` + "\n")
	}
	w.WriteString(`</aside>
</div>`)
}

func writeIssueMention(w *page, m *issueMention) {
	w.WriteString(`<li class="issue `)
	w.WriteString(m.State)
	w.WriteString(`"><a class="title" href="/p/`)
	w.WriteString(m.Project.Slug)
	w.WriteString(`/issues/`)
	writeInt(w, int(m.Number))
	wrapped(w, `">`, m.Title, "</a>\n")
}

func writeMentionMeta(w *page, m *issueMention) {
	w.WriteString(`<div class="meta"><a href="/p/`)
	w.WriteString(m.Project.Slug)
	wrapped(w, `/issues">`, m.Project.Name, `</a> #`)
	writeInt(w, int(m.Number))
	w.WriteString(` opened `)
	writeTimeTag(w, m.CreatedAt, writeDay)
	w.WriteString(` by `)
	writeUserLink(w, &m.Author)
}

func writeIssueMentions(w *page, list []issueMention) {
	for i := range list {
		if i > 0 {
			w.WriteByte('\n')
		}
		writeIssueMention(w, &list[i])
		writeMentionMeta(w, &list[i])
		w.WriteString(`</div></li>`)
	}
}

func homeView(w *page, projects []projectSummary, newest []issueMention) {
	w.WriteString("<h1>Projects</h1>\n<ul class=\"projects\">\n")
	for i := range projects {
		p := &projects[i]
		if i > 0 {
			w.WriteByte('\n')
		}
		w.WriteString(`<li><a href="/p/`)
		w.WriteString(p.Slug)
		wrapped(w, `/issues">`, p.Name, `</a> <span class="count">`)
		writeNumber(w, int(p.OpenIssues))
		w.WriteString(` open, `)
		writeNumber(w, int(p.ClosedIssues))
		wrapped(w, " closed</span>\n<p>", p.Description, `</p></li>`)
	}
	w.WriteString("\n</ul>\n<h2>Newest issues</h2>\n<ul class=\"issues\">\n")
	writeIssueMentions(w, newest)
	w.WriteString("\n</ul>")
}

func searchURL(text string, n int) string {
	address := appendFormEncoded([]byte("/search?q="), text)
	if n != 1 {
		address = strconv.AppendInt(append(address, "&page="...), int64(n), 10)
	}
	return string(address)
}

func searchView(w *page, text string, terms []string, hits []searchHit, total, current, perPage int) {
	if text == "" {
		w.WriteString("<h1>Search</h1>\n<p>Type some words into the box above.</p>")
		return
	}
	w.WriteString(`<h1>`)
	writeCount(w, total, "issue")
	wrapped(w, ` for “`, text, "”</h1>\n")
	if len(hits) == 0 {
		w.WriteString(`<p class="empty">Nothing here.</p>`)
	} else {
		w.WriteString(`<ul class="hits">`)
		for i := range hits {
			hit := &hits[i]
			w.WriteByte('\n')
			writeIssueMention(w, &hit.issueMention)
			w.WriteString(`<p>`)
			writeMarkedExcerpt(w, hit.Body, terms)
			w.WriteString("</p>\n")
			writeMentionMeta(w, &hit.issueMention)
			w.WriteString(`, `)
			writeCount(w, int(hit.CommentCount), "comment")
			w.WriteString(`</div></li>`)
		}
		w.WriteString("\n</ul>")
	}
	w.WriteByte('\n')
	writePagination(w, current, (total+perPage-1)/perPage, func(n int) string { return searchURL(text, n) })
}

func profileView(w *page, p *profile) {
	wrapped(w, `<h1>`, p.User.Name, ` <span class="login">@`)
	w.WriteString(p.User.Login)
	w.WriteString(`</span>`)
	if p.User.Role == "admin" {
		w.WriteString(` <span class="badge">Admin</span>`)
	}
	wrapped(w, "</h1>\n<p class=\"bio\">", p.User.Bio, "</p>\n<p class=\"meta\">Joined ")
	writeTimeTag(w, p.User.CreatedAt, writeDay)
	w.WriteString(`, `)
	writeCount(w, int(p.IssueCount), "issue")
	w.WriteString(`, `)
	writeCount(w, int(p.CommentCount), "comment")
	w.WriteString("</p>\n<h2>Newest issues</h2>\n")
	if len(p.Issues) == 0 {
		w.WriteString(`<p class="empty">None yet.</p>`)
	} else {
		w.WriteString("<ul class=\"issues\">\n")
		writeIssueMentions(w, p.Issues)
		w.WriteString("\n</ul>")
	}
	w.WriteString("\n<h2>Newest comments</h2>\n")
	if len(p.Comments) == 0 {
		w.WriteString(`<p class="empty">None yet.</p>`)
		return
	}
	w.WriteString(`<ul class="comments">`)
	for i := range p.Comments {
		c := &p.Comments[i]
		w.WriteString("\n" + `<li><a href="/p/`)
		w.WriteString(c.Project.Slug)
		w.WriteString(`/issues/`)
		writeInt(w, int(c.Issue.Number))
		w.WriteString(`#comment-`)
		writeInt(w, int(c.ID))
		wrapped(w, `">`, c.Issue.Title, `</a> <span class="meta">`)
		escape(w, c.Project.Name)
		w.WriteString(` #`)
		writeInt(w, int(c.Issue.Number))
		w.WriteString(`, `)
		writeTimeTag(w, c.CreatedAt, writeDay)
		wrapped(w, "</span>\n<p>", summary(c.Body, 24), `</p></li>`)
	}
	w.WriteString("\n</ul>")
}

func writeDuration(w *page, minutes int) {
	days, hours := minutes/1440, minutes%1440/60
	if days > 0 {
		writeNumber(w, days)
		w.WriteString(` d `)
		writeInt(w, hours)
		w.WriteString(` h`)
	} else {
		writeInt(w, hours)
		w.WriteString(` h `)
		writeInt(w, minutes%60)
		w.WriteString(` min`)
	}
}

// Two bars a month: opened and closed.
func writeChart(w *page, months []monthCount) {
	most := 1
	for _, m := range months {
		most = max(most, int(m.Opened), int(m.Closed))
	}
	bar := func(kind string, x, count int) {
		height := count * 120 / most
		w.WriteString(`<rect class="`)
		w.WriteString(kind)
		w.WriteString(`" x="`)
		writeInt(w, x)
		w.WriteString(`" y="`)
		writeInt(w, 120-height)
		w.WriteString(`" width="14" height="`)
		writeInt(w, height)
		w.WriteString(`"><title>`)
		writeNumber(w, count)
		w.WriteByte(' ')
		w.WriteString(kind)
		w.WriteString(`</title></rect>`)
	}
	w.WriteString(`<svg class="chart" viewBox="0 0 `)
	writeInt(w, len(months)*40)
	w.WriteString(` 140" width="`)
	writeInt(w, len(months)*40)
	w.WriteString(`" height="140" role="img">`)
	for i, m := range months {
		w.WriteByte('\n')
		bar("opened", i*40+4, int(m.Opened))
		bar("closed", i*40+20, int(m.Closed))
		w.WriteString(`<text x="`)
		writeInt(w, i*40+4)
		w.WriteString(`" y="134" font-size="9">`)
		w.WriteString(m.Month[2:])
		w.WriteString(`</text>`)
	}
	w.WriteString("\n</svg>")
}

func writeCells(w *page, first string, numbers ...int) {
	w.WriteString(`<tr><td>`)
	w.WriteString(first)
	for _, n := range numbers {
		w.WriteString(`</td><td>`)
		writeNumber(w, n)
	}
}

func adminView(w *page, stats *adminStats) {
	t := &stats.Totals
	w.WriteString(`<h1>Admin</h1>
<table>
<tr><th>Users</th><th>Projects</th><th>Open issues</th><th>Closed issues</th><th>Comments</th></tr>
<tr><td>`)
	writeNumber(w, int(t.Users))
	for _, n := range [...]int32{t.Projects, t.OpenIssues, t.ClosedIssues, t.Comments} {
		w.WriteString(`</td><td>`)
		writeNumber(w, int(n))
	}
	w.WriteString(`</td></tr>
</table>
<h2>Opened and closed by month</h2>
`)
	writeChart(w, stats.Months)
	w.WriteString(`
<table>
<tr><th>Month</th><th>Opened</th><th>Closed</th><th>Net</th></tr>`)
	for _, m := range stats.Months {
		w.WriteByte('\n')
		writeCells(w, m.Month, int(m.Opened), int(m.Closed), int(m.Opened-m.Closed))
		w.WriteString(`</td></tr>`)
	}
	w.WriteString(`
</table>
<h2>By priority</h2>
<table>
<tr><th>Priority</th><th>Open</th><th>Mean time to close</th></tr>`)
	for _, p := range stats.Priorities {
		w.WriteByte('\n')
		writeCells(w, priorityNames[p.Priority], int(p.Open))
		w.WriteString(`</td><td>`)
		writeDuration(w, int(p.MinutesToClose))
		w.WriteString(`</td></tr>`)
	}
	w.WriteString(`
</table>
<h2>Who comments most</h2>
<ol>`)
	for i := range stats.Commenters {
		c := &stats.Commenters[i]
		w.WriteString("\n<li>")
		writeUserLink(w, &c.userRef)
		w.WriteString(` <span class="count">`)
		writeNumber(w, int(c.Comments))
		w.WriteString(`</span></li>`)
	}
	w.WriteString(`
</ol>
<h2>Where most is said</h2>
<ol>`)
	for i := range stats.Busiest {
		b := &stats.Busiest[i]
		w.WriteString("\n" + `<li><a href="/p/`)
		w.WriteString(b.Slug)
		wrapped(w, `/issues">`, b.Name, `</a> <span class="count">`)
		writeNumber(w, int(b.Comments))
		w.WriteString(`</span></li>`)
	}
	w.WriteString("\n</ol>")
}

var messages = map[string]string{
	"title":    "The title must have 1 to 200 characters.",
	"body":     "The text must have at most 20,000 characters.",
	"priority": "Choose a priority.",
	"labels":   "Choose at most 12 labels.",
	"assignee": "There is no user with that login.",
	"state":    "An issue is open or closed.",
	"parentId": "The comment that this answers is not part of this issue.",
	"login":    "The login or the password is wrong.",
}

// What is wrong with a form, for a person. invalid holds paths such as "title" or "labels.3".
func writeErrorList(w *page, invalid []string) {
	if len(invalid) == 0 {
		return
	}
	w.WriteString(`<ul class="errors">`)
	seen := make(map[string]bool, len(invalid))
	for _, path := range invalid {
		name, _, _ := strings.Cut(path, ".")
		if seen[name] {
			continue
		}
		seen[name] = true
		message, known := messages[name]
		if !known {
			message = "The form is not complete."
		}
		w.WriteString("\n<li>")
		w.WriteString(message)
		w.WriteString(`</li>`)
	}
	w.WriteString("\n</ul>\n")
}

type issueFormValues struct {
	title    string
	body     string
	priority int // -1: none
	labels   []string
	assignee string
	state    string // "": the form has no state
}

func writeOption(w *page, value, name string, selected bool) {
	w.WriteString(`<option value="`)
	w.WriteString(value)
	w.WriteByte('"')
	if selected {
		w.WriteString(` selected`)
	}
	w.WriteByte('>')
	w.WriteString(name)
	w.WriteString(`</option>`)
}

// number 0: a new issue.
func issueFormView(w *page, p *project, number int32, values *issueFormValues, labels []label, s *session, invalid []string) {
	issues := "/p/" + p.Slug + "/issues"
	w.WriteString(`<nav class="breadcrumb"><a href="/">Projects</a> / <a href="`)
	w.WriteString(issues)
	wrapped(w, `">`, p.Name, `</a> / `)
	if number == 0 {
		w.WriteString("New issue</nav>\n<h1>New issue</h1>\n")
	} else {
		w.WriteString(`<a href="`)
		w.WriteString(issues)
		w.WriteByte('/')
		writeInt(w, int(number))
		w.WriteString(`">#`)
		writeInt(w, int(number))
		w.WriteString("</a> / Edit</nav>\n<h1>Edit issue #")
		writeInt(w, int(number))
		w.WriteString("</h1>\n")
	}
	writeErrorList(w, invalid)
	w.WriteString(`<form method="post" action="`)
	w.WriteString(issues)
	if number != 0 {
		w.WriteByte('/')
		writeInt(w, int(number))
	}
	w.WriteString(`">
<input type="hidden" name="csrf" value="`)
	w.WriteString(s.CSRFToken)
	wrapped(w, `">
<label>Title <input name="title" value="`, values.title, `" required maxlength="200"></label>
<label>Text <textarea name="body" rows="12" maxlength="20000">`)
	escape(w, values.body)
	w.WriteString(`</textarea></label>
<label>Priority <select name="priority">`)
	for priority, name := range priorityNames {
		writeOption(w, strconv.Itoa(priority), name, priority == values.priority)
	}
	w.WriteString("</select></label>\n")
	if values.state != "" {
		w.WriteString(`<label>State <select name="state">`)
		writeOption(w, "open", "open", values.state == "open")
		writeOption(w, "closed", "closed", values.state == "closed")
		w.WriteString("</select></label>\n")
	}
	w.WriteString(`<fieldset><legend>Labels</legend>`)
	for i := range labels {
		wrapped(w, "\n"+`<label><input type="checkbox" name="labels" value="`, labels[i].Name, `"`)
		if slices.Contains(values.labels, labels[i].Name) {
			w.WriteString(` checked`)
		}
		wrapped(w, `> `, labels[i].Name, `</label>`)
	}
	wrapped(w, `
</fieldset>
<label>Assignee <input name="assignee" value="`, values.assignee, `" placeholder="login"></label>
<button>`)
	if number == 0 {
		w.WriteString(`Create issue`)
	} else {
		w.WriteString(`Save`)
	}
	w.WriteString("</button>\n</form>")
}

func loginView(w *page, login string, invalid []string) {
	w.WriteString("<h1>Sign in</h1>\n")
	writeErrorList(w, invalid)
	wrapped(w, `<form method="post" action="/login">
<label>Login <input name="login" value="`, login, `" required autocomplete="username"></label>
<label>Password <input type="password" name="password" required autocomplete="current-password"></label>
<button>Sign in</button>
</form>`)
}
