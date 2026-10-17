// The same as main.ts. It is built together with the files of ../rivals/go other than main.go.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type loaded struct {
	project  project
	issue    issue
	comments []comment
}

func number(text string) int32 {
	n, _ := strconv.Atoi(text)
	return int32(n)
}

func moment(text string) timestamp {
	n, _ := strconv.ParseInt(text, 10, 64)
	return timestamp(time.UnixMilli(n))
}

func optionalMoment(text string) *timestamp {
	if text == "" {
		return nil
	}
	t := moment(text)
	return &t
}

func load(text string) []loaded {
	var all []loaded
	for _, block := range strings.Split(strings.TrimRight(text, "\n"), "\x1d") {
		records := strings.Split(block, "\x1e")
		f := strings.Split(records[0], "\x1f")
		one := loaded{project: project{number(f[0]), f[1], f[2], f[3]}}
		one.issue = issue{issueSummary{number(f[4]), number(f[5]), f[6], f[7], number(f[8]), number(f[9]), moment(f[10]), moment(f[11]), userRef{f[12], f[13]}, nil, []label{}}, f[17], optionalMoment(f[16])}
		if f[14] != "" {
			one.issue.Assignee = &userRef{f[14], f[15]}
		}
		if records[1] != "" {
			l := strings.Split(records[1], "\x1f")
			for k := 0; k+2 < len(l); k += 3 {
				one.issue.Labels = append(one.issue.Labels, label{number(l[k]), l[k+1], l[k+2]})
			}
		}
		for _, record := range records[2:] {
			c := strings.Split(record, "\x1f")
			row := comment{ID: number(c[0]), Author: userRef{c[2], c[3]}, Body: c[6], CreatedAt: moment(c[4]), EditedAt: optionalMoment(c[5])}
			if c[1] != "" {
				parent := number(c[1])
				row.ParentID = &parent
			}
			one.comments = append(one.comments, row)
		}
		all = append(all, one)
	}
	return all
}

var signedIn = &session{Token: strings.Repeat("t", 64), CSRFToken: strings.Repeat("c", 32), User: sessionUser{7, "tomas-ali-7", "Tomás Ali", "member"}}

func inBuffer(write func(*page)) int {
	body := pages.Get().(*bytes.Buffer)
	body.Reset()
	write(body)
	n := body.Len()
	pages.Put(body)
	return n
}

var pieces = map[string]func(*loaded) int{
	"page": func(l *loaded) int {
		return inBuffer(func(body *page) {
			layout(body, l.issue.Title+" · Issue #"+strconv.Itoa(int(l.issue.Number)), signedIn, "", func(body *page) {
				issuePageView(body, &l.project, &l.issue, buildThread(l.comments), participantsOf(l.comments), signedIn, 0)
			})
		})
	},
	"json": func(l *loaded) int {
		return inBuffer(func(body *page) {
			encoder := json.NewEncoder(body)
			encoder.SetEscapeHTML(false)
			encoder.Encode(issueAnswer{&l.project, &l.issue, participantsOf(l.comments), buildThread(l.comments)})
			body.Truncate(body.Len() - 1)
		})
	},
	"thread": func(l *loaded) int {
		return len(buildThread(l.comments)) + len(participantsOf(l.comments))
	},
	"markdown": func(l *loaded) int {
		return inBuffer(func(body *page) {
			renderMarkdown(body, l.issue.Body, l.project.Slug)
			for i := range l.comments {
				renderMarkdown(body, l.comments[i].Body, l.project.Slug)
			}
		})
	},
	"dates": func(l *loaded) int {
		return inBuffer(func(body *page) {
			for i := range l.comments {
				writeTimeTag(body, l.comments[i].CreatedAt, writeMinute)
			}
		})
	},
	"escape": func(l *loaded) int {
		n := 0
		for i := range l.comments {
			n += inBuffer(func(body *page) { escape(body, l.comments[i].Body) })
			n += utf16Length(string(bytes.Clone(func() []byte { var b page; escape(&b, l.comments[i].Author.Name); return b.Bytes() }())))
		}
		return n
	},
}

// rows fetches one issue's comments, one query per round.
func rows(issueID int32, rounds int) int {
	config, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		panic(err)
	}
	config.MaxConns = 1
	ctx := context.Background()
	if pool, err = pgxpool.NewWithConfig(ctx, config); err != nil {
		panic(err)
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		panic(err)
	}
	var comments []comment
	for ; rounds > 0; rounds-- {
		batch := &pgx.Batch{}
		queueCommentsOf(batch, issueID, int32(len(comments)), &comments)
		if err := run(ctx, conn, batch); err != nil {
			panic(err)
		}
	}
	return len(comments)
}

func main() {
	if os.Args[1] == "rows" {
		rounds, _ := strconv.Atoi(os.Args[3])
		fmt.Println("rows", rows(number(os.Args[2]), rounds))
		return
	}
	piece := pieces[os.Args[1]]
	text, err := os.ReadFile(os.Args[2])
	if err != nil {
		panic(err)
	}
	rounds, _ := strconv.Atoi(os.Args[3])
	all := load(string(text))
	total := 0
	for ; rounds > 0; rounds-- {
		total = 0
		for i := range all {
			total += piece(&all[i])
		}
	}
	fmt.Println(os.Args[1], total)
}
