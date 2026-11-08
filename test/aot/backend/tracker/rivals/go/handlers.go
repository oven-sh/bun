package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var pool *pgxpool.Pool

var pages = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func send(w http.ResponseWriter, status int, contentType string, body *bytes.Buffer) {
	header := w.Header()
	header.Set("Content-Type", contentType)
	header.Set("Content-Length", strconv.Itoa(body.Len()))
	w.WriteHeader(status)
	w.Write(body.Bytes())
}

func sendPage(w http.ResponseWriter, status int, write func(*page)) {
	body := pages.Get().(*bytes.Buffer)
	body.Reset()
	write(body)
	send(w, status, "text/html; charset=utf-8", body)
	pages.Put(body)
}

func sendJSON(w http.ResponseWriter, status int, value any) {
	body := pages.Get().(*bytes.Buffer)
	body.Reset()
	encoder := json.NewEncoder(body)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		pages.Put(body)
		failed(w, err)
		return
	}
	body.Truncate(body.Len() - 1)
	send(w, status, "application/json", body)
	pages.Put(body)
}

type problem struct {
	Error string `json:"error"`
}

func sendProblem(w http.ResponseWriter, status int, message string) {
	sendJSON(w, status, problem{message})
}

func failed(w http.ResponseWriter, err error) {
	log.Print(err)
	http.Error(w, "Internal Server Error", http.StatusInternalServerError)
}

func notFoundPage(w http.ResponseWriter, s *session) {
	sendPage(w, http.StatusNotFound, func(body *page) { errorPage(body, s, "Not found", "There is no such page.") })
}

// 304 where the client holds what the tag names.
func notModified(w http.ResponseWriter, r *http.Request, etag string) bool {
	if r.Header.Get("If-None-Match") != etag {
		return false
	}
	w.Header().Set("ETag", etag)
	w.WriteHeader(http.StatusNotModified)
	return true
}

func run(ctx context.Context, conn *pgxpool.Conn, batch *pgx.Batch) error {
	if batch.Len() == 0 {
		return nil
	}
	return conn.SendBatch(ctx, batch).Close()
}

// The session that the browser's cookie names goes into the batch.
func queueCookieSession(batch *pgx.Batch, r *http.Request, found **session) {
	if cookie, err := r.Cookie("sid"); err == nil && cookie.Value != "" {
		queueSession(batch, cookie.Value, found)
	}
}

// A flash message is shown once.
func forgetFlash(ctx context.Context, conn *pgxpool.Conn, s *session) error {
	if s == nil || s.Flash == nil {
		return nil
	}
	_, err := conn.Exec(ctx, `UPDATE sessions SET flash = NULL WHERE token = $1`, s.Token)
	return err
}

func issueListPage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		failed(w, err)
		return
	}
	defer conn.Release()

	var s *session
	var p *project
	batch := &pgx.Batch{}
	queueCookieSession(batch, r, &s)
	queueProject(batch, r.PathValue("project"), &p)
	if err = run(ctx, conn, batch); err == nil {
		err = forgetFlash(ctx, conn, s)
	}
	if err != nil {
		failed(w, err)
		return
	}
	if p == nil {
		notFoundPage(w, s)
		return
	}

	filters := parseFilters(r.URL.Query(), 25, 25)
	var issues []issueSummary
	var counts stateCounts
	var labels []labelCount
	batch = &pgx.Batch{}
	queueIssues(batch, p.ID, filters, &issues)
	queueCountByState(batch, p.ID, filters.Label, &counts)
	queueCountByLabel(batch, p.ID, &labels)
	if err = run(ctx, conn, batch); err == nil && len(issues) > 0 {
		batch = &pgx.Batch{}
		queueLabelsOfIssues(batch, issues)
		err = run(ctx, conn, batch)
	}
	if err != nil {
		failed(w, err)
		return
	}
	sendPage(w, http.StatusOK, func(body *page) {
		layout(body, "Issues of "+p.Name, s, "", func(body *page) { issueListView(body, p, filters, issues, counts, labels, s != nil) })
	})
}

func issueTag(i *issue, userID int32, withUser bool) string {
	tag := make([]byte, 0, 48)
	tag = append(tag, '"')
	tag = strconv.AppendInt(tag, int64(i.ID), 10)
	tag = append(tag, '-')
	tag = strconv.AppendInt(tag, i.UpdatedAt.milliseconds(), 10)
	tag = append(tag, '-')
	tag = strconv.AppendInt(tag, int64(i.CommentCount), 10)
	if withUser {
		tag = append(tag, '-')
		tag = strconv.AppendInt(tag, int64(userID), 10)
	}
	return string(append(tag, '"'))
}

func issuePage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		failed(w, err)
		return
	}
	defer conn.Release()

	var s *session
	var found *foundIssue
	batch := &pgx.Batch{}
	queueCookieSession(batch, r, &s)
	if number := positiveInteger(r.PathValue("number")); number != 0 {
		queueIssue(batch, r.PathValue("project"), number, &found)
	}
	if err = run(ctx, conn, batch); err == nil {
		err = forgetFlash(ctx, conn, s)
	}
	if err != nil {
		failed(w, err)
		return
	}
	if found == nil {
		notFoundPage(w, s)
		return
	}
	p, i := &found.project, &found.issue

	var userID int32
	if s != nil {
		userID = s.User.ID
	}
	etag := issueTag(i, userID, true)
	if (s == nil || s.Flash == nil || *s.Flash == "") && notModified(w, r, etag) {
		return
	}

	var comments []comment
	batch = &pgx.Batch{}
	queueLabelsOf(batch, i.ID, &i.Labels)
	queueCommentsOf(batch, i.ID, i.CommentCount, &comments)
	if err = run(ctx, conn, batch); err != nil {
		failed(w, err)
		return
	}
	replyTo := positiveInteger(r.URL.Query().Get("reply_to"))
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	sendPage(w, http.StatusOK, func(body *page) {
		layout(body, i.Title+" · Issue #"+strconv.Itoa(int(i.Number)), s, "", func(body *page) {
			issuePageView(body, p, i, buildThread(comments), participantsOf(comments), s, replyTo)
		})
	})
}

type issueListAnswer struct {
	Project *project       `json:"project"`
	Filters issueFilters   `json:"filters"`
	Total   int32          `json:"total"`
	Issues  []issueSummary `json:"issues"`
}

func apiIssueList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		failed(w, err)
		return
	}
	defer conn.Release()

	var p *project
	batch := &pgx.Batch{}
	queueProject(batch, r.PathValue("project"), &p)
	if err = run(ctx, conn, batch); err != nil {
		failed(w, err)
		return
	}
	if p == nil {
		sendProblem(w, http.StatusNotFound, "no such project")
		return
	}
	filters := parseFilters(r.URL.Query(), 50, 100)
	var issues []issueSummary
	var counts stateCounts
	batch = &pgx.Batch{}
	queueIssues(batch, p.ID, filters, &issues)
	queueCountByState(batch, p.ID, filters.Label, &counts)
	if err = run(ctx, conn, batch); err == nil && len(issues) > 0 {
		batch = &pgx.Batch{}
		queueLabelsOfIssues(batch, issues)
		err = run(ctx, conn, batch)
	}
	if err != nil {
		failed(w, err)
		return
	}
	sendJSON(w, http.StatusOK, issueListAnswer{p, filters, counts.of(filters.State), issues})
}

type issueAnswer struct {
	Project      *project       `json:"project"`
	Issue        *issue         `json:"issue"`
	Participants []*participant `json:"participants"`
	Comments     []*commentNode `json:"comments"`
}

func apiIssue(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		failed(w, err)
		return
	}
	defer conn.Release()

	var found *foundIssue
	batch := &pgx.Batch{}
	if number := positiveInteger(r.PathValue("number")); number != 0 {
		queueIssue(batch, r.PathValue("project"), number, &found)
	}
	if err = run(ctx, conn, batch); err != nil {
		failed(w, err)
		return
	}
	if found == nil {
		sendProblem(w, http.StatusNotFound, "no such issue")
		return
	}
	p, i := &found.project, &found.issue
	etag := issueTag(i, 0, false)
	if notModified(w, r, etag) {
		return
	}
	var comments []comment
	batch = &pgx.Batch{}
	queueLabelsOf(batch, i.ID, &i.Labels)
	queueCommentsOf(batch, i.ID, i.CommentCount, &comments)
	if err = run(ctx, conn, batch); err != nil {
		failed(w, err)
		return
	}
	w.Header().Set("ETag", etag)
	sendJSON(w, http.StatusOK, issueAnswer{p, i, participantsOf(comments), buildThread(comments)})
}

func notFound(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		sendProblem(w, http.StatusNotFound, "not found")
	} else {
		notFoundPage(w, nil)
	}
}
