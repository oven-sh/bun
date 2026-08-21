#!/usr/bin/env bash
# Usage: ./run.sh <bun-binary> [baseline-bun-binary]
# Runs the Bun.serve overhead benchmark in each mode and prints oha summaries.
set -euo pipefail
BUN=${1:-bun}
BASE=${2:-$BUN}
DUR=${DUR:-10s}
CONC=${CONC:-64}
AWAITS=${AWAITS:-2}
here=$(cd "$(dirname "$0")" && pwd)
COLLECTOR_PORT=${COLLECTOR_PORT:-4319}

$BASE "$here/collector.js" 2>/dev/null & COL=$!
trap 'kill $COL 2>/dev/null || true' EXIT
sleep 0.3

runone() {
  local label=$1 bin=$2; shift 2
  env "$@" PORT=3999 AWAITS=$AWAITS OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:$COLLECTOR_PORT "$bin" "$here/server.js" 2>/dev/null & local PID=$!
  sleep 0.5
  # warmup
  oha -z 3s -c $CONC --no-tui http://localhost:3999/bench >/dev/null 2>&1
  printf "%-28s " "$label"
  oha -z $DUR -c $CONC --no-tui --json http://localhost:3999/bench 2>/dev/null | bun -e 'const j=JSON.parse(await Bun.stdin.text()); console.log(`${j.summary.requestsPerSec.toFixed(0).padStart(8)} req/s   p50 ${(j.latencyPercentiles.p50*1e3).toFixed(3)}ms   p99 ${(j.latencyPercentiles.p99*1e3).toFixed(3)}ms   rss ${""}`)'
  kill $PID; wait $PID 2>/dev/null || true
}

runone "baseline (no telemetry)" "$BASE" MODE=none
runone "branch, telemetry off" "$BUN" MODE=none
runone "branch, Bun.otel on" "$BUN" MODE=native BUN_OTEL=1 BUN_OTEL_INSTRUMENTATIONS=http,fetch
runone "baseline, otel-js sdk" "$BASE" MODE=sdk
