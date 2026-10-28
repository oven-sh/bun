package main

import "time"

// A moment that JSON spells as JavaScript's Date does: 2026-10-16T13:45:00.000Z.
type timestamp time.Time

const isoLayout = "2006-01-02T15:04:05.000Z"

func (t timestamp) MarshalJSON() ([]byte, error) {
	text := make([]byte, 0, len(isoLayout)+2)
	text = append(text, '"')
	text = time.Time(t).UTC().AppendFormat(text, isoLayout)
	return append(text, '"'), nil
}

func (t timestamp) milliseconds() int64 {
	return time.Time(t).UnixMilli()
}

func optional(t *time.Time) *timestamp {
	if t == nil {
		return nil
	}
	return (*timestamp)(t)
}

type userRef struct {
	Login string `json:"login"`
	Name  string `json:"name"`
}

type project struct {
	ID          int32  `json:"id"`
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type label struct {
	ID    int32  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type labelCount struct {
	label
	OpenIssues int32 `json:"openIssues"`
}

type issueSummary struct {
	ID           int32     `json:"id"`
	Number       int32     `json:"number"`
	Title        string    `json:"title"`
	State        string    `json:"state"`
	Priority     int32     `json:"priority"`
	CommentCount int32     `json:"commentCount"`
	CreatedAt    timestamp `json:"createdAt"`
	UpdatedAt    timestamp `json:"updatedAt"`
	Author       userRef   `json:"author"`
	Assignee     *userRef  `json:"assignee"`
	Labels       []label   `json:"labels"`
}

type issue struct {
	issueSummary
	Body     string     `json:"body"`
	ClosedAt *timestamp `json:"closedAt"`
}

type comment struct {
	ID        int32      `json:"id"`
	ParentID  *int32     `json:"parentId"`
	Author    userRef    `json:"author"`
	Body      string     `json:"body"`
	CreatedAt timestamp  `json:"createdAt"`
	EditedAt  *timestamp `json:"editedAt"`
}

type commentNode struct {
	comment
	Replies []*commentNode `json:"replies"`
}

type participant struct {
	userRef
	Comments int `json:"comments"`
}

type stateCounts struct {
	Open   int32 `json:"open"`
	Closed int32 `json:"closed"`
}

func (c stateCounts) of(state string) int32 {
	if state == "closed" {
		return c.Closed
	}
	return c.Open
}

type sessionUser struct {
	ID    int32
	Login string
	Name  string
	Role  string
}

type session struct {
	Token     string
	CSRFToken string
	Flash     *string
	User      sessionUser
}

type projectSummary struct {
	project
	OpenIssues   int32 `json:"openIssues"`
	ClosedIssues int32 `json:"closedIssues"`
}

type projectRef struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// An issue as it is shown outside the pages of its project.
type issueMention struct {
	Project   projectRef `json:"project"`
	Number    int32      `json:"number"`
	Title     string     `json:"title"`
	State     string     `json:"state"`
	CreatedAt timestamp  `json:"createdAt"`
	Author    userRef    `json:"author"`
}

type searchHit struct {
	issueMention
	Body         string
	CommentCount int32
}

type user struct {
	ID        int32     `json:"id"`
	Login     string    `json:"login"`
	Name      string    `json:"name"`
	Bio       string    `json:"bio"`
	Role      string    `json:"role"`
	CreatedAt timestamp `json:"createdAt"`
}

type issueRef struct {
	Number int32  `json:"number"`
	Title  string `json:"title"`
}

type commentMention struct {
	ID        int32      `json:"id"`
	Project   projectRef `json:"project"`
	Issue     issueRef   `json:"issue"`
	Body      string     `json:"body"`
	CreatedAt timestamp  `json:"createdAt"`
}

type profile struct {
	User         user             `json:"user"`
	IssueCount   int32            `json:"issueCount"`
	CommentCount int32            `json:"commentCount"`
	Issues       []issueMention   `json:"issues"`
	Comments     []commentMention `json:"comments"`
}

type totals struct {
	Users        int32 `json:"users"`
	Projects     int32 `json:"projects"`
	OpenIssues   int32 `json:"openIssues"`
	ClosedIssues int32 `json:"closedIssues"`
	Comments     int32 `json:"comments"`
}

type monthCount struct {
	Month  string `json:"month"`
	Opened int32  `json:"opened"`
	Closed int32  `json:"closed"`
}

type priorityCount struct {
	Priority       int32 `json:"priority"`
	Open           int32 `json:"open"`
	MinutesToClose int32 `json:"minutesToClose"`
}

type commenter struct {
	userRef
	Comments int32 `json:"comments"`
}

type busyProject struct {
	projectRef
	Comments int32 `json:"comments"`
}

type adminStats struct {
	Totals     totals          `json:"totals"`
	Months     []monthCount    `json:"months"`
	Priorities []priorityCount `json:"priorities"`
	Commenters []commenter     `json:"commenters"`
	Busiest    []busyProject   `json:"busiest"`
}
