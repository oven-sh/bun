#!/bin/bash
# Usage: BUN=/abs/path/to/bun bench/site/run-all.sh [bundler] [http] [ws] [postgres] [install]
# Results: $SITEBENCH_HOME/results/<UTC stamp>-<bun label>/  (also symlinked as results/latest)
set -u
BUN=${BUN:?set BUN=/abs/path/to/bun}
STAMP=$(date -u +%Y%m%d-%H%M%S)
S=${SITEBENCH_HOME:-$HOME/sitebench}
export OUT=$S/results/$STAMP-$(basename "$(dirname "$BUN")")-$("$BUN" --version)
mkdir -p "$OUT"; ln -sfn "$OUT" "$S/results/latest"
export BUN
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
BENCHES=${@:-bundler http ws postgres install}
cd "$S"
{
  echo "date_utc=$STAMP host=$(hostname) cpu=\"$(lscpu | sed -n 's/Model name: *//p')\" cores=$(nproc) mem_gb=$(free -g | awk '/Mem/{print $2}') kernel=$(uname -r)"
  echo "BUN=$BUN version=$($BUN --version) revision=$($BUN --revision)"
  echo "bun_release=$($BUN_RELEASE --version) node=$($NODE --version) deno=$($DENO --version | head -1) pnpm=$($PNPM --version) yarn=$($YARN --version) npm=$($NPM --version)"
  echo "bombardier=$(bombardier --version 2>&1 | head -1) hyperfine=$(hyperfine --version) postgres=$(postgres --version 2>/dev/null || echo n/a)"
  (cd "$S/benchmarks" && echo "rolldown_benchmarks=$(git rev-parse --short HEAD) $($NODE -e 'for (const p of ["esbuild","rolldown","@rspack/core","@rsbuild/core","rollup","vite"]) process.stdout.write(p+"="+require(p+"/package.json").version+" ")')")
  (cd "$BENCH_DIR" && echo "bun_bench=$(git rev-parse --short HEAD) express=$($NODE -p 'require("./express/node_modules/express/package.json").version') ws=$($NODE -p 'require("./websocket-server/node_modules/ws/package.json").version') postgres_js=$($NODE -p 'require("./postgres/node_modules/postgres/package.json").version')")
} > "$OUT/versions.txt"
cat "$OUT/versions.txt"
: > "$OUT/timings.txt"
for b in $BENCHES; do
  echo "############ $b  $(date -u +%H:%M:%S)"
  t0=$(date +%s)
  timeout -k 30 "${BENCH_TIMEOUT:-3600}" bash "$SITE_DIR/bench/$b.sh" > "$OUT/$b.log" 2>&1; rc=$?
  [ $rc = 124 ] && echo "$b TIMED_OUT after ${BENCH_TIMEOUT:-3600}s" | tee -a "$OUT/$b.log"
  t1=$(date +%s)
  echo "$b  ${rc}  $((t1-t0))s" | tee -a "$OUT/timings.txt"
done
echo "############ ALLDONE $(date -u +%H:%M:%S)  results in $OUT"
