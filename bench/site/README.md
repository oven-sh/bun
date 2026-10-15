# bun.com homepage benchmarks

This directory is the reproducible source for the benchmark numbers shown on [bun.com](https://bun.com): the bundler,
HTTP server, WebSocket, Postgres and `bun install` cards. It runs the benchmark sources that already live in `bench/`
(`bench/express`, `bench/websocket-server`, `bench/postgres`, `bench/install`) plus the
[rolldown/benchmarks](https://github.com/rolldown/benchmarks) bundler harness, against pinned versions of every
runtime and package manager, and writes one results directory per run.

Linux x64 only (it reads `/proc`, uses GNU `time`, `lscpu` and `free`).

## Running it

```sh
bench/site/setup-toolchains.sh                      # node, deno, pnpm/yarn/npm, bun release + canary -> $SITEBENCH_HOME/toolchains
bench/site/setup-repos.sh                           # rolldown/benchmarks clone + deps of bench/express, bench/websocket-server, bench/postgres
BUN=/abs/path/to/bun bench/site/run-all.sh          # everything: bundler http ws postgres install (~30 min with RUNS=3)
BUN=/abs/path/to/bun bench/site/run-all.sh http ws  # a subset
RUNS=1 BUN=... bench/site/run-all.sh                # quick smoke run
```

- `BUN` (required) is the Bun binary under test. The fixed comparison row is always `toolchains/bun-release/bun`.
- `SITEBENCH_HOME` (default `~/sitebench`) holds toolchains, the rolldown/benchmarks clone, per-PM caches, the Postgres
  data dir, scratch files and `results/`. Nothing is installed system-wide; `bombardier`, `hyperfine`, `openssl` and a
  PostgreSQL server binary (`pg_ctl`/`initdb`, or `SITEBENCH_PG_EXTERNAL=1` + `PG*` variables for a running server) must
  already be on `PATH`.
- `RUNS` (default 3) is the number of repetitions for http, ws, postgres and install. The bundler harness always does
  hyperfine's 10 runs per tool. Each benchmark script is killed after `BENCH_TIMEOUT` seconds (default 3600).

Results land in `$SITEBENCH_HOME/results/<UTC stamp>-<dir of $BUN>-<bun version>/` (symlinked as `results/latest`):

| file                                                                            | contents                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `versions.txt`                                                                  | machine (CPU model, cores, RAM, kernel) and the exact version of every runtime, package manager and tool used |
| `timings.txt`                                                                   | `<bench> <exit code> <wall seconds>` per benchmark                                                            |
| `bundler-10000.json`, `bundler-10000-bun-release.json`, `bundler-10000-rss.txt` | hyperfine JSON per bundler, the bun-release row, peak RSS per bundler                                         |
| `http.txt`                                                                      | req/s per run, server CPU %, peak RSS per server                                                              |
| `ws.txt`                                                                        | msgs/s, server CPU %, peak RSS per server and repetition                                                      |
| `postgres.txt`                                                                  | wall ms, driver-reported ms, peak RSS per run                                                                 |
| `install.txt`                                                                   | `<pm> <scenario> r<N> <ms> peak_rss rc` for every package manager and scenario                                |
| `*.log`                                                                         | full stdout/stderr of each benchmark script                                                                   |

## What is measured

**bundler.sh** - `node bench.mjs --app apps/10000` from rolldown/benchmarks: a 10,000-component React app (~19k modules)
built for production with sourcemaps by vite, rsbuild, rspack, rollup, rolldown, esbuild and `bun build`, hyperfine 10
runs each. `bun` on `PATH` is a shim symlink to `$BUN`. Then the same `bun build` command under bun-release, and one build
per tool under GNU `time` for peak RSS. The harness has no warmup, so the first vite run is a cold outlier.

**http.sh** - `bench/express/express-tls.mjs` (Express 5 hello world over HTTPS with a self-signed cert generated into
`$SITEBENCH_HOME/certs`) under `$BUN`, bun-release, node and `deno run -A`; 3 s warmup, then
`bombardier -k -c 50 -d 5s -l -H "Accept-Encoding: identity"` x RUNS. Plaintext `express.mjs` and the native servers in
`servers/` (`Bun.serve`, `node:https`/`node:http`, `Deno.serve`) over TLS and plaintext are recorded as context. Server
CPU is the `/proc` utime+stime delta over the measured window; peak RSS is `VmHWM`. HTTPS is used because that is what
the site publishes and what production servers terminate.

**ws.sh** - `bench/websocket-server`: a chat room with 32 clients where every message is echoed to every client. The
clients are split across `K=4` client processes (`CLIENTS_COUNT=8 TOTAL_CLIENTS=32`, always run under bun-release), so the
client side is not the bottleneck and every server gets the identical bounded workload. Rows: `$BUN` with
`ws.publish()` (`chat-server.bun.js`), `$BUN` broadcasting with a `ws.send()` loop (`servers/chat-server.bun-send.js`,
the same shape as the node and Deno servers), bun-release, node `ws`, `Deno.upgradeWebSocket`. msgs/s is the sum over
client processes of the per-second samples 2-10; server CPU over an 8 s window; peak RSS.

**postgres.sh** - `bench/postgres/index.mjs`: 100,000 `SELECT * FROM users_bun_bench LIMIT 100` queries with 100 in
flight, `Bun.sql` under `$BUN` and bun-release, `postgres.js` under node and deno, against a PostgreSQL server the script
starts from `$SITEBENCH_HOME/pgdata` (trust auth on 127.0.0.1) and stops afterwards. Wall time around the process,
the driver-reported `console.time`, peak RSS via GNU `time`.

**install.sh** - `bench/install` (a create-t3-app Next.js app: 25 direct dependencies, ~220 resolved packages) installed
by `$BUN`, `$BUN --linker=isolated`, bun-release, pnpm, yarn 1 and npm. Every package manager gets a private cache/store
under `$SITEBENCH_HOME/caches` (`BUN_INSTALL_CACHE_DIR`, `npm_config_cache`, `YARN_CACHE_FOLDER`,
`--store-dir`/`--cache-dir` for pnpm) so "cold" only ever wipes our own cache; pnpm and yarn run with `--prefer-offline`,
npm with `--prefer-offline --no-audit --no-fund`. Six scenarios x RUNS each, wall ms around the process and peak RSS:
`clean` (no cache, lockfile or node_modules), `cache` (warm cache only), `ci-cold` (lockfile only), `ci-cache`
(lockfile + warm cache), `nm-lock` (lockfile + node_modules, cold cache), `uptodate` (everything present).

## How the published numbers were produced

- Machine: a dedicated AWS EC2 instance, AMD EPYC 9R14, 64 vCPUs, 128 GB RAM, Amazon Linux 2023 (kernel 6.1), otherwise
  idle. Client and server run on the same machine.
- `RUNS=3`; every repetition is recorded and the published number is the median repetition, labelled with the versions
  from `versions.txt`.
- Versions pinned in `setup-toolchains.sh` / `setup-repos.sh` / the `bench/*/package.json` files: Node v26.7.0,
  Deno 2.9.5, pnpm 11.21.0, yarn 1.22.22, npm 12.0.2, Bun 1.3.14 as the release row, rolldown/benchmarks at `257a5850`
  with its bundlers bumped to npm `latest` as of 2026-08-14 (esbuild 0.28.2, rolldown 1.2.4, rspack 2.1.10,
  rsbuild 2.1.13, rollup 4.62.4, vite 8.2.1), Express 5.2.1, ws 8.21.3 (bufferutil 4.1.0, utf-8-validate 6.0.6),
  postgres.js 3.4.9, PostgreSQL 18.3, bombardier, hyperfine 1.19.0.
- The Bun under test is a release or canary build from GitHub releases (PR builds are produced without the symbol
  order file, so only release/canary artifacts are comparable to the release row).
