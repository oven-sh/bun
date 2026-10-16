# An issue tracker on Bun.serve and Bun.sql, and the same in Go and in Rust

`app/` is a web application of 2,000 lines of strict TypeScript. It uses no framework and no package: `Bun.serve` and its
routes, `Bun.sql` on Postgres, validation by declared types (`Bun.safeValidate<T>()`), template strings. It is written the way one
writes TypeScript: interfaces, `async` and `await`, `map` and `join`, `Map` and `Set`. Nothing in it is written for a compiler.

| | pages | JSON |
|---|---|---|
| the projects, the newest issues | `GET /` | `GET /api/projects` |
| the issues of a project: open or closed, by label, sorted three ways, in pages, with counts | `GET /p/:project/issues` | `GET /api/projects/:project/issues` |
| an issue: its text and its comments as a tree, Markdown rendered, who took part | `GET /p/:project/issues/:number` | `GET /api/projects/:project/issues/:number` |
| full-text search, with the words found marked | `GET /search?q=` | `GET /api/search?q=` |
| a user: counts, newest issues, newest comments | `GET /u/:login` | `GET /api/users/:login` |
| aggregates for administrators, with a chart | `GET /admin` | `GET /api/admin/stats` |
| a new issue, in a transaction | `GET /p/:project/issues/new`, `POST /p/:project/issues` | `POST /api/projects/:project/issues` |
| an issue changed, closed, opened again | `GET /p/:project/issues/:number/edit`, `POST /p/:project/issues/:number` | `PATCH /api/projects/:project/issues/:number` |
| a comment or a reply | `POST /p/:project/issues/:number/comments` | `POST /api/projects/:project/issues/:number/comments` |
| signing in and out | `GET /login`, `POST /login`, `POST /logout` | `Authorization: Bearer <session>` |

A browser has a session: a cookie, a row, a token that every form must carry, and a message that is shown once on the next page.
Pages of issues and the style sheet answer conditional requests with 304.

`schema.sql` makes the tables and fills them: 5,000 users, 60 projects, 30,000 issues, 348,000 comments, 330 MB. A sixth of the
comments hold text that is not Latin-1.

`rivals/go` (net/http, pgx, encoding/json) and `rivals/rust` (axum, tokio-postgres, deadpool, serde, mimalloc) are the same
application: the same routes, the same SQL, the same bytes in every answer. Both write a page into one buffer from beginning to
end, which is what templ, maud and askama generate. Independent queries of a request go to Postgres together in all three:
`Promise.all`, `pgx.Batch`, `tokio::try_join!`.

`by-hand/validation.ts`, laid over `app/`, has the same checks written out by hand, for a Bun that cannot validate by type.

## The test

`exchanges.ts` holds the requests: 3,300 of them, to every route, with what is rare (nobody signed in, a session that is over, odd
parameters, bodies of the wrong type, forms without a token) and a sequence that writes. `bun exchanges.ts compare a=<port> b=<port>`
sends each to every server and shows where two answers part.

`tracker.test.ts` is opt-in and needs Postgres. It builds `app/` with `--aot`, runs `by-hand/` without, and compares. Its first lines
say how to run it, and how to have Go and Rust compared too.

## The pieces

`pieces/` holds what one request computes, without a socket and without a database, in a loop: `page` (the tree of comments,
Markdown, dates, escaping, the layout, UTF-8), `json`, `thread`, `markdown`, `dates`, `escape`. `main.ts` imports the modules of `app/`,
`main.go` is built together with the files of `rivals/go` other than its `main.go`, and `main.rs` is the second binary of `rivals/rust`.
Each prints how many bytes a round made, which is the same number in all three.

```sh
psql "$DATABASE_URL" -tA -f pieces/export.sql > out/issues.txt          # twenty issues with their comments
(cd pieces && bun build --compile --aot --target=bun ./main.ts --outfile ../out/pieces-aot)
perf stat -e instructions:u,cycles:u out/pieces-aot page out/issues.txt 1000
```

## The benchmark

As in `../README.md`, with `../measure/measure.py`. A test is a set of `exchanges.ts`: `issue`, `list`, `api-issue`, `api-list`,
`search`, `api-search`, `profile`, `api-user`, `home`, `comment`, `api-comment`, or `mix`, a thousand requests in the proportions of a
day's traffic.

```sh
psql "$DATABASE_URL" -f schema.sql
(cd app && bun install && bun build --compile --aot --target=bun ./server.ts --outfile ../out/aot)
cp -r app out/app-by-hand && cp -r by-hand/. out/app-by-hand/
(cd out/app-by-hand && bun build --compile --target=bun ./server.ts --outfile ../jit)
(cd rivals/go && go build -o ../../out/go .)
(cd rivals/rust && cargo build --release && cp target/release/tracker ../../out/rust)
cc -O2 -pthread -o out/load ../measure/load.c

PORT=3000 out/jit & bun exchanges.ts write out/golden 3000; kill $!      # each request with its answer; then fill the database anew
SERVER_CORES=0 CLIENT_CORES=4-7 POSTGRES_CORES=8-15 POSTMASTER_PID=$(head -1 "$PGDATA/postmaster.pid") \
DATABASE_POOL=2 GO_RUN_ENV=DATABASE_POOL=64 RUST_RUN_ENV=DATABASE_POOL=64 \
  python3 ../measure/measure.py out out/golden out/rows.tsv issue,list,api-issue,mix aot,jit,go,rust
```
