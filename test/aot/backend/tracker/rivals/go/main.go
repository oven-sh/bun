// The same routes as ../../app/server.ts, on net/http and pgx.
package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://tracker:tracker@127.0.0.1:5432/tracker"
	}
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		log.Fatal(err)
	}
	if size, err := strconv.Atoi(os.Getenv("DATABASE_POOL")); err == nil {
		config.MaxConns = int32(size)
	}
	pool, err = pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	route := func(path string, methods map[string]http.HandlerFunc) {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if handle, found := methods[r.Method]; found {
				handle(w, r)
			} else {
				notFound(w, r)
			}
		})
	}
	route("/{$}", map[string]http.HandlerFunc{"GET": connected(homePage)})
	route("/assets/app.css", map[string]http.HandlerFunc{"GET": stylesheetFile})
	route("/login", map[string]http.HandlerFunc{"GET": connected(loginPage), "POST": connected(login)})
	route("/logout", map[string]http.HandlerFunc{"POST": connected(logout)})
	route("/search", map[string]http.HandlerFunc{"GET": connected(searchPage)})
	route("/admin", map[string]http.HandlerFunc{"GET": connected(adminPage)})
	route("/u/{login}", map[string]http.HandlerFunc{"GET": connected(profilePage)})
	route("/p/{project}/issues", map[string]http.HandlerFunc{"GET": issueListPage, "POST": connected(createIssue)})
	route("/p/{project}/issues/new", map[string]http.HandlerFunc{"GET": connected(newIssuePage)})
	route("/p/{project}/issues/{number}", map[string]http.HandlerFunc{"GET": issuePage, "POST": connected(saveIssue)})
	route("/p/{project}/issues/{number}/edit", map[string]http.HandlerFunc{"GET": connected(editIssuePage)})
	route("/p/{project}/issues/{number}/comments", map[string]http.HandlerFunc{"POST": connected(createComment)})
	route("/api/projects", map[string]http.HandlerFunc{"GET": connected(apiProjects)})
	route("/api/projects/{project}/issues", map[string]http.HandlerFunc{"GET": apiIssueList, "POST": connected(apiCreateIssue)})
	route("/api/projects/{project}/issues/{number}", map[string]http.HandlerFunc{"GET": apiIssue, "PATCH": connected(apiUpdateIssue)})
	route("/api/projects/{project}/issues/{number}/comments", map[string]http.HandlerFunc{"POST": connected(apiCreateComment)})
	route("/api/search", map[string]http.HandlerFunc{"GET": connected(apiSearch)})
	route("/api/users/{login}", map[string]http.HandlerFunc{"GET": connected(apiUser)})
	route("/api/admin/stats", map[string]http.HandlerFunc{"GET": connected(apiAdminStats)})
	mux.HandleFunc("/", notFound)

	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("listening", listener.Addr().(*net.TCPAddr).Port)
	log.Fatal(http.Serve(listener, mux))
}
