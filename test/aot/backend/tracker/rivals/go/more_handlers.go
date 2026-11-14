package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A handler that has a connection to the database for as long as it runs.
type handler func(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error

func connected(h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		conn, err := pool.Acquire(ctx)
		if err == nil {
			defer conn.Release()
			err = h(ctx, conn, w, r)
		}
		if err != nil {
			failed(w, err)
		}
	}
}

func seeOther(w http.ResponseWriter, location string) {
	w.Header().Set("Location", location)
	w.WriteHeader(http.StatusSeeOther)
}

func sendLayout(w http.ResponseWriter, status int, title string, s *session, searchText string, content func(*page)) {
	sendPage(w, status, func(body *page) { layout(body, title, s, searchText, content) })
}

func forbidden(w http.ResponseWriter, s *session, message string) {
	sendPage(w, http.StatusForbidden, func(body *page) { errorPage(body, s, "Forbidden", message) })
}

// Runs the batch, to which the session of the browser's cookie is added.
func runWithSession(ctx context.Context, conn *pgxpool.Conn, r *http.Request, batch *pgx.Batch) (*session, error) {
	var s *session
	queueCookieSession(batch, r, &s)
	if err := run(ctx, conn, batch); err != nil {
		return nil, err
	}
	return s, forgetFlash(ctx, conn, s)
}

// The same for a client of the API: Authorization: Bearer <token>.
func runWithBearer(ctx context.Context, conn *pgxpool.Conn, r *http.Request, batch *pgx.Batch) (*session, error) {
	var s *session
	if token, found := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); found {
		queueSession(batch, token, &s)
	}
	if err := run(ctx, conn, batch); err != nil {
		return nil, err
	}
	return s, forgetFlash(ctx, conn, s)
}

func homePage(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	var projects []projectSummary
	var newest []issueMention
	batch := &pgx.Batch{}
	queueProjects(batch, &projects)
	queueNewestIssues(batch, 10, &newest)
	s, err := runWithSession(ctx, conn, r, batch)
	if err != nil {
		return err
	}
	sendLayout(w, http.StatusOK, "Projects", s, "", func(body *page) { homeView(body, projects, newest) })
	return nil
}

func stylesheetFile(w http.ResponseWriter, r *http.Request) {
	if notModified(w, r, stylesheetTag) {
		return
	}
	header := w.Header()
	header.Set("Content-Type", "text/css; charset=utf-8")
	header.Set("ETag", stylesheetTag)
	header.Set("Cache-Control", "public, max-age=3600")
	header.Set("Content-Length", strconv.Itoa(len(stylesheet)))
	io.WriteString(w, stylesheet)
}

const hitsPerPage = 20

func searchPage(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	params := r.URL.Query()
	text := strings.TrimSpace(params.Get("q"))
	current := wholeNumber(params.Get("page"), 1, 1, 1000)
	var hits []searchHit
	var total int32
	batch := &pgx.Batch{}
	if text != "" {
		queueSearch(batch, text, hitsPerPage, (current-1)*hitsPerPage, &hits)
		queueCountHits(batch, text, &total)
	}
	s, err := runWithSession(ctx, conn, r, batch)
	if err != nil {
		return err
	}
	title := "Search"
	if text != "" {
		title = "Search: " + text
	}
	sendLayout(w, http.StatusOK, title, s, text, func(body *page) {
		searchView(body, text, strings.Fields(strings.ToLower(text)), hits, int(total), current, hitsPerPage)
	})
	return nil
}

// What is shown of a user. The user is looked for in the batch that is handed in.
func loadProfile(ctx context.Context, conn *pgxpool.Conn, login string, first *pgx.Batch, runFirst func(*pgx.Batch) error) (*profile, error) {
	var u *user
	queueUser(first, login, &u)
	if err := runFirst(first); err != nil || u == nil {
		return nil, err
	}
	p := &profile{User: *u}
	batch := &pgx.Batch{}
	queueProfile(batch, p)
	return p, run(ctx, conn, batch)
}

func profilePage(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	var s *session
	p, err := loadProfile(ctx, conn, r.PathValue("login"), &pgx.Batch{}, func(batch *pgx.Batch) (err error) {
		s, err = runWithSession(ctx, conn, r, batch)
		return err
	})
	if err != nil {
		return err
	}
	if p == nil {
		notFoundPage(w, s)
		return nil
	}
	sendLayout(w, http.StatusOK, p.User.Name, s, "", func(body *page) { profileView(body, p) })
	return nil
}

func adminPage(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	s, err := runWithSession(ctx, conn, r, &pgx.Batch{})
	if err != nil {
		return err
	}
	if s == nil {
		seeOther(w, "/login")
		return nil
	}
	if s.User.Role != "admin" {
		forbidden(w, s, "This page is for administrators.")
		return nil
	}
	var stats adminStats
	batch := &pgx.Batch{}
	queueAdminStats(batch, &stats)
	if err := run(ctx, conn, batch); err != nil {
		return err
	}
	sendLayout(w, http.StatusOK, "Admin", s, "", func(body *page) { adminView(body, &stats) })
	return nil
}

// What a browser posts: forms, checked against the session's token, answered with a redirect or with the form and what is wrong with it.

func formOf(r *http.Request) (url.Values, error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	form, _ := url.ParseQuery(string(body))
	return form, nil
}

func textOf(form url.Values, name string) string {
	return strings.TrimSpace(strings.ReplaceAll(form.Get(name), "\r\n", "\n"))
}

// The form of a request by someone who is signed in and whose form carries the token of the session. Otherwise it has been answered.
func signedForm(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) (*session, url.Values, error) {
	form, err := formOf(r)
	if err != nil {
		return nil, nil, err
	}
	s, err := runWithSession(ctx, conn, r, &pgx.Batch{})
	if err != nil {
		return nil, nil, err
	}
	if s == nil {
		seeOther(w, "/login")
		return nil, nil, nil
	}
	if form.Get("csrf") != s.CSRFToken {
		forbidden(w, s, "The form has expired. Go back, reload the page and try again.")
		return nil, nil, nil
	}
	return s, form, nil
}

func mayEdit(s *session, i *issue) bool {
	return s.User.Login == i.Author.Login || s.User.Role == "admin"
}

func issueValues(form url.Values, withState bool) (*issueFormValues, *issueInput) {
	values := &issueFormValues{title: textOf(form, "title"), body: textOf(form, "body"), priority: -1, labels: form["labels"], assignee: strings.TrimSpace(form.Get("assignee"))}
	input := &issueInput{Title: given(values.title), Body: given(values.body)}
	if priority, err := strconv.Atoi(form.Get("priority")); err == nil {
		values.priority, input.Priority = priority, given(priority)
	}
	names := make([]*string, len(values.labels))
	for i := range values.labels {
		names[i] = &values.labels[i]
	}
	input.Labels = given(names)
	if values.assignee != "" {
		input.Assignee = given(values.assignee)
	}
	if withState {
		values.state = "open"
		if form.Get("state") == "closed" {
			values.state = "closed"
		}
		input.State = given(values.state)
	}
	return values, input
}

func issueFormPage(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, p *project, number int32, values *issueFormValues, s *session, invalid []string, status int) error {
	var labels []label
	batch := &pgx.Batch{}
	queueLabelsOfProject(batch, p.ID, &labels)
	if err := run(ctx, conn, batch); err != nil {
		return err
	}
	title := "New issue in " + p.Name
	if number != 0 {
		title = "Edit issue #" + strconv.Itoa(int(number))
	}
	sendLayout(w, status, title, s, "", func(body *page) { issueFormView(body, p, number, values, labels, s, invalid) })
	return nil
}

func newIssuePage(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	var p *project
	batch := &pgx.Batch{}
	queueProject(batch, r.PathValue("project"), &p)
	s, err := runWithSession(ctx, conn, r, batch)
	if err != nil {
		return err
	}
	if p == nil {
		notFoundPage(w, s)
		return nil
	}
	if s == nil {
		seeOther(w, "/login")
		return nil
	}
	return issueFormPage(ctx, conn, w, p, 0, &issueFormValues{priority: 1}, s, nil, http.StatusOK)
}

func findProject(ctx context.Context, conn *pgxpool.Conn, slug string) (*project, error) {
	var p *project
	batch := &pgx.Batch{}
	queueProject(batch, slug, &p)
	return p, run(ctx, conn, batch)
}

func findIssue(ctx context.Context, conn *pgxpool.Conn, r *http.Request) (*foundIssue, error) {
	var found *foundIssue
	batch := &pgx.Batch{}
	if number := positiveInteger(r.PathValue("number")); number != 0 {
		queueIssue(batch, r.PathValue("project"), number, &found)
	}
	return found, run(ctx, conn, batch)
}

func issueAddress(p *project, number int32) string {
	return "/p/" + p.Slug + "/issues/" + strconv.Itoa(int(number))
}

func createIssue(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	s, form, err := signedForm(ctx, conn, w, r)
	if s == nil {
		return err
	}
	p, err := findProject(ctx, conn, r.PathValue("project"))
	if err != nil {
		return err
	}
	if p == nil {
		notFoundPage(w, s)
		return nil
	}
	values, input := issueValues(form, false)
	if refused := input.check(true); len(refused.invalid) > 0 {
		return issueFormPage(ctx, conn, w, p, 0, values, s, refused.invalid, http.StatusUnprocessableEntity)
	}
	var assigneeID *int32
	if values.assignee != "" {
		if assigneeID, err = findUserID(ctx, conn, values.assignee); err != nil {
			return err
		}
		if assigneeID == nil {
			return issueFormPage(ctx, conn, w, p, 0, values, s, []string{"assignee"}, http.StatusUnprocessableEntity)
		}
	}
	number, err := insertIssue(ctx, conn, p, s, issueFields{values.title, values.body, values.priority, values.labels, assigneeID}, "The issue was created.")
	if err != nil {
		return err
	}
	seeOther(w, issueAddress(p, number))
	return nil
}

func editIssuePage(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	var found *foundIssue
	batch := &pgx.Batch{}
	if number := positiveInteger(r.PathValue("number")); number != 0 {
		queueIssue(batch, r.PathValue("project"), number, &found)
	}
	s, err := runWithSession(ctx, conn, r, batch)
	if err != nil {
		return err
	}
	if found == nil {
		notFoundPage(w, s)
		return nil
	}
	if s == nil {
		seeOther(w, "/login")
		return nil
	}
	p, i := &found.project, &found.issue
	if !mayEdit(s, i) {
		forbidden(w, s, "Only the author of an issue can edit it.")
		return nil
	}
	batch = &pgx.Batch{}
	queueLabelsOf(batch, i.ID, &i.Labels)
	if err := run(ctx, conn, batch); err != nil {
		return err
	}
	values := &issueFormValues{title: i.Title, body: i.Body, priority: int(i.Priority), state: i.State}
	for _, l := range i.Labels {
		values.labels = append(values.labels, l.Name)
	}
	if i.Assignee != nil {
		values.assignee = i.Assignee.Login
	}
	return issueFormPage(ctx, conn, w, p, i.Number, values, s, nil, http.StatusOK)
}

func saveIssue(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	s, form, err := signedForm(ctx, conn, w, r)
	if s == nil {
		return err
	}
	found, err := findIssue(ctx, conn, r)
	if err != nil {
		return err
	}
	if found == nil {
		notFoundPage(w, s)
		return nil
	}
	p, i := &found.project, &found.issue
	if !mayEdit(s, i) {
		forbidden(w, s, "Only the author of an issue can edit it.")
		return nil
	}
	values, input := issueValues(form, true)
	if !input.Priority.Set {
		input.Priority = field[int]{Set: true, Null: true}
	}
	if refused := input.check(false); len(refused.invalid) > 0 {
		return issueFormPage(ctx, conn, w, p, i.Number, values, s, refused.invalid, http.StatusUnprocessableEntity)
	}
	var assigneeID *int32
	if values.assignee != "" {
		if assigneeID, err = findUserID(ctx, conn, values.assignee); err != nil {
			return err
		}
		if assigneeID == nil {
			return issueFormPage(ctx, conn, w, p, i.Number, values, s, []string{"assignee"}, http.StatusUnprocessableEntity)
		}
	}
	if err := updateIssue(ctx, conn, p, i, s, issueFields{values.title, values.body, values.priority, values.labels, assigneeID}, values.state, "The issue was saved."); err != nil {
		return err
	}
	seeOther(w, issueAddress(p, i.Number))
	return nil
}

func createComment(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	s, form, err := signedForm(ctx, conn, w, r)
	if s == nil {
		return err
	}
	found, err := findIssue(ctx, conn, r)
	if err != nil {
		return err
	}
	if found == nil {
		notFoundPage(w, s)
		return nil
	}
	p, i := &found.project, &found.issue

	input := commentInput{Body: given(textOf(form, "body"))}
	valid := true
	if parent := form.Get("parent_id"); parent != "" {
		n, err := strconv.Atoi(parent)
		input.ParentID, valid = given(n), err == nil
	}
	valid = valid && len(input.check().invalid) == 0
	var parentID *int
	if valid && input.ParentID.Set {
		parentID = &input.ParentID.Value
		if valid, err = commentBelongsTo(ctx, conn, *parentID, i.ID); err != nil {
			return err
		}
	}
	if !valid {
		sendPage(w, http.StatusUnprocessableEntity, func(body *page) {
			errorPage(body, s, "The comment was not saved", "A comment must have 1 to 20,000 characters and answer a comment of the same issue.")
		})
		return nil
	}
	id, _, err := insertComment(ctx, conn, i, s, input.Body.Value, parentID, "Your comment was added.")
	if err != nil {
		return err
	}
	seeOther(w, issueAddress(p, i.Number)+"#comment-"+strconv.Itoa(int(id)))
	return nil
}

func loginPage(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	s, err := runWithSession(ctx, conn, r, &pgx.Batch{})
	if err != nil {
		return err
	}
	if s != nil {
		seeOther(w, "/")
		return nil
	}
	sendLayout(w, http.StatusOK, "Sign in", nil, "", func(body *page) { loginView(body, "", nil) })
	return nil
}

const thirtyDays = 30 * 24 * 60 * 60

func login(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	form, err := formOf(r)
	if err != nil {
		return err
	}
	name, password := strings.TrimSpace(form.Get("login")), form.Get("password")
	matches := false
	var userID int32
	if length := utf16Length(password); isLogin(name) && length >= 1 && length <= 200 {
		var salt, hash string
		err := conn.QueryRow(ctx, `SELECT id, password_salt, password_hash FROM users WHERE login = $1`, name).Scan(&userID, &salt, &hash)
		if ignoreNoRows(err) != nil {
			return err
		}
		matches = err == nil && passwordMatches(password, salt, hash)
	}
	if !matches {
		sendLayout(w, http.StatusUnauthorized, "Sign in", nil, "", func(body *page) { loginView(body, name, []string{"login"}) })
		return nil
	}
	token := randomToken(32)
	if _, err := conn.Exec(ctx, `INSERT INTO sessions (token, user_id, csrf_token, expires_at)
    VALUES ($1, $2, $3, now() + $4 * interval '1 second')`, token, userID, randomToken(16), float64(thirtyDays)); err != nil {
		return err
	}
	w.Header().Set("Set-Cookie", "sid="+token+"; Path=/; Max-Age="+strconv.Itoa(thirtyDays)+"; HttpOnly; SameSite=Lax")
	seeOther(w, "/")
	return nil
}

func logout(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	s, _, err := signedForm(ctx, conn, w, r)
	if s == nil {
		return err
	}
	if _, err := conn.Exec(ctx, `DELETE FROM sessions WHERE token = $1`, s.Token); err != nil {
		return err
	}
	w.Header().Set("Set-Cookie", "sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax")
	seeOther(w, "/")
	return nil
}

// The rest of the API.

type projectsAnswer struct {
	Projects []projectSummary `json:"projects"`
}

func apiProjects(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	var answer projectsAnswer
	batch := &pgx.Batch{}
	queueProjects(batch, &answer.Projects)
	if err := run(ctx, conn, batch); err != nil {
		return err
	}
	sendJSON(w, http.StatusOK, answer)
	return nil
}

type hitAnswer struct {
	*issueMention
	CommentCount int32  `json:"commentCount"`
	Summary      string `json:"summary"`
}

type searchAnswer struct {
	Query string      `json:"query"`
	Page  int         `json:"page"`
	Total int32       `json:"total"`
	Hits  []hitAnswer `json:"hits"`
}

func apiSearch(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	params := r.URL.Query()
	text := strings.TrimSpace(params.Get("q"))
	if text == "" {
		sendProblem(w, http.StatusBadRequest, "q is missing")
		return nil
	}
	answer := searchAnswer{Query: text, Page: wholeNumber(params.Get("page"), 1, 1, 1000)}
	var hits []searchHit
	batch := &pgx.Batch{}
	queueSearch(batch, text, 20, (answer.Page-1)*20, &hits)
	queueCountHits(batch, text, &answer.Total)
	if err := run(ctx, conn, batch); err != nil {
		return err
	}
	answer.Hits = make([]hitAnswer, len(hits))
	for i := range hits {
		answer.Hits[i] = hitAnswer{&hits[i].issueMention, hits[i].CommentCount, summary(hits[i].Body, 30)}
	}
	sendJSON(w, http.StatusOK, answer)
	return nil
}

func apiUser(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	p, err := loadProfile(ctx, conn, r.PathValue("login"), &pgx.Batch{}, func(batch *pgx.Batch) error { return run(ctx, conn, batch) })
	if err != nil {
		return err
	}
	if p == nil {
		sendProblem(w, http.StatusNotFound, "no such user")
	} else {
		sendJSON(w, http.StatusOK, p)
	}
	return nil
}

func apiAdminStats(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	s, err := runWithBearer(ctx, conn, r, &pgx.Batch{})
	if err != nil {
		return err
	}
	if s == nil {
		sendProblem(w, http.StatusUnauthorized, "not signed in")
		return nil
	}
	if s.User.Role != "admin" {
		sendProblem(w, http.StatusForbidden, "for administrators")
		return nil
	}
	var stats adminStats
	batch := &pgx.Batch{}
	queueAdminStats(batch, &stats)
	if err := run(ctx, conn, batch); err != nil {
		return err
	}
	sendJSON(w, http.StatusOK, &stats)
	return nil
}

type invalidAnswer struct {
	Error  string   `json:"error"`
	Fields []string `json:"fields"`
}

func sendRefusal(w http.ResponseWriter, refused refusal) {
	if refused.malformed {
		sendProblem(w, http.StatusBadRequest, "malformed")
	} else {
		sendJSON(w, http.StatusUnprocessableEntity, invalidAnswer{"invalid", refused.invalid})
	}
}

var malformed = refusal{malformed: true}

// Reads the body of a request as a JSON object into a value. False: it is something else.
func bodyInto(r *http.Request, value any) bool {
	body, err := io.ReadAll(r.Body)
	return err == nil && len(body) > 0 && strings.HasPrefix(strings.TrimLeft(string(body), " \t\r\n"), "{") && json.Unmarshal(body, value) == nil
}

type madeAnswer struct {
	Number int32  `json:"number"`
	URL    string `json:"url"`
}

func made(p *project, number int32) madeAnswer {
	return madeAnswer{number, "/api/projects/" + p.Slug + "/issues/" + strconv.Itoa(int(number))}
}

func apiCreateIssue(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	var input issueInput
	wellFormed := bodyInto(r, &input)
	var p *project
	batch := &pgx.Batch{}
	queueProject(batch, r.PathValue("project"), &p)
	s, err := runWithBearer(ctx, conn, r, batch)
	if err != nil {
		return err
	}
	if s == nil {
		sendProblem(w, http.StatusUnauthorized, "not signed in")
		return nil
	}
	if p == nil {
		sendProblem(w, http.StatusNotFound, "no such project")
		return nil
	}
	if !wellFormed {
		sendRefusal(w, malformed)
		return nil
	}
	if refused := input.check(true); len(refused.invalid) > 0 {
		sendRefusal(w, refused)
		return nil
	}
	var assigneeID *int32
	if input.Assignee.Set && !input.Assignee.Null {
		if assigneeID, err = findUserID(ctx, conn, input.Assignee.Value); err != nil {
			return err
		}
		if assigneeID == nil {
			sendRefusal(w, refusal{invalid: []string{"assignee"}})
			return nil
		}
	}
	number, err := insertIssue(ctx, conn, p, s, issueFields{input.Title.Value, input.Body.Value, input.Priority.Value, input.labelNames(), assigneeID}, "")
	if err != nil {
		return err
	}
	sendJSON(w, http.StatusCreated, made(p, number))
	return nil
}

// The session of the bearer and the issue that the path names, asked for together.
func bearerAndIssue(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) (*session, *foundIssue, error) {
	var found *foundIssue
	batch := &pgx.Batch{}
	if number := positiveInteger(r.PathValue("number")); number != 0 {
		queueIssue(batch, r.PathValue("project"), number, &found)
	}
	s, err := runWithBearer(ctx, conn, r, batch)
	if err != nil {
		return nil, nil, err
	}
	if s == nil {
		sendProblem(w, http.StatusUnauthorized, "not signed in")
		return nil, nil, nil
	}
	if found == nil {
		sendProblem(w, http.StatusNotFound, "no such issue")
		return nil, nil, nil
	}
	return s, found, nil
}

func apiUpdateIssue(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	var input issueInput
	wellFormed := bodyInto(r, &input)
	s, found, err := bearerAndIssue(ctx, conn, w, r)
	if s == nil {
		return err
	}
	p, i := &found.project, &found.issue
	if !mayEdit(s, i) {
		sendProblem(w, http.StatusForbidden, "not your issue")
		return nil
	}
	if !wellFormed {
		sendRefusal(w, malformed)
		return nil
	}
	if refused := input.check(false); len(refused.invalid) > 0 {
		sendRefusal(w, refused)
		return nil
	}

	fields, state := issueFields{title: i.Title, body: i.Body, priority: int(i.Priority)}, i.State
	if input.Title.Set {
		fields.title = input.Title.Value
	}
	if input.Body.Set {
		fields.body = input.Body.Value
	}
	if input.Priority.Set {
		fields.priority = input.Priority.Value
	}
	if input.State.Set {
		state = input.State.Value
	}
	assignee := ""
	if input.Assignee.Set {
		assignee = input.Assignee.Value
	} else if i.Assignee != nil {
		assignee = i.Assignee.Login
	}
	if assignee != "" {
		if fields.assigneeID, err = findUserID(ctx, conn, assignee); err != nil {
			return err
		}
	}
	if input.Labels.Set {
		fields.labels = input.labelNames()
	} else {
		batch := &pgx.Batch{}
		queueLabelsOf(batch, i.ID, &i.Labels)
		if err := run(ctx, conn, batch); err != nil {
			return err
		}
		for _, l := range i.Labels {
			fields.labels = append(fields.labels, l.Name)
		}
	}
	if assignee != "" && fields.assigneeID == nil {
		sendRefusal(w, refusal{invalid: []string{"assignee"}})
		return nil
	}
	if err := updateIssue(ctx, conn, p, i, s, fields, state, ""); err != nil {
		return err
	}
	sendJSON(w, http.StatusOK, made(p, i.Number))
	return nil
}

type commentAnswer struct {
	ID        int32     `json:"id"`
	ParentID  *int      `json:"parentId"`
	Author    userRef   `json:"author"`
	Body      string    `json:"body"`
	CreatedAt timestamp `json:"createdAt"`
}

func apiCreateComment(ctx context.Context, conn *pgxpool.Conn, w http.ResponseWriter, r *http.Request) error {
	var input commentInput
	wellFormed := bodyInto(r, &input)
	s, found, err := bearerAndIssue(ctx, conn, w, r)
	if s == nil {
		return err
	}
	if !wellFormed {
		sendRefusal(w, malformed)
		return nil
	}
	if refused := input.check(); len(refused.invalid) > 0 {
		sendRefusal(w, refused)
		return nil
	}
	var parentID *int
	if input.ParentID.Set && !input.ParentID.Null {
		parentID = &input.ParentID.Value
		belongs, err := commentBelongsTo(ctx, conn, *parentID, found.issue.ID)
		if err != nil {
			return err
		}
		if !belongs {
			sendRefusal(w, refusal{invalid: []string{"parentId"}})
			return nil
		}
	}
	id, createdAt, err := insertComment(ctx, conn, &found.issue, s, input.Body.Value, parentID, "")
	if err != nil {
		return err
	}
	sendJSON(w, http.StatusCreated, commentAnswer{id, parentID, userRef{s.User.Login, s.User.Name}, input.Body.Value, createdAt})
	return nil
}
