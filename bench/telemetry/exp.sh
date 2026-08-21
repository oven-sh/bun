#!/usr/bin/env bash
set -euo pipefail
BUN=$1; BASE=$2
DUR=${DUR:-10s}; CONC=${CONC:-64}; AWAITS=${AWAITS:-2}
here=$(cd "$(dirname "$0")" && pwd)
TCK=$(getconf CLK_TCK)
taskset -c 30 $BASE "$here/collector.js" 2>/dev/null & COL=$!
trap 'kill $COL 2>/dev/null || true' EXIT
sleep 0.3
cputicks() { awk '{print $14+$15}' /proc/$1/stat; }
runone() {
  local label=$1 bin=$2; shift 2
  env "$@" PORT=3999 AWAITS=$AWAITS OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4319 taskset -c 4 "$bin" "$here/server.js" 2>/dev/null & local PID=$!
  sleep 0.5
  taskset -c 8-23 oha -z 3s -c $CONC --no-tui http://localhost:3999/bench >/dev/null 2>&1
  local t0=$(cputicks $PID)
  local json=$(taskset -c 8-23 oha -z $DUR -c $CONC --no-tui --output-format json http://localhost:3999/bench 2>/dev/null)
  local t1=$(cputicks $PID)
  local rss=$(awk '/VmRSS/{print $2}' /proc/$PID/status)
  printf "%-34s " "$label"
  echo "$json" | TICKS=$((t1-t0)) TCK=$TCK RSS=$rss bun -e 'const j=JSON.parse(await Bun.stdin.text()); const n=Object.values(j.statusCodeDistribution).reduce((a,b)=>a+b,0); const cpu=+process.env.TICKS/+process.env.TCK; console.log(`${j.summary.requestsPerSec.toFixed(0).padStart(8)} req/s  p50 ${(j.latencyPercentiles.p50*1e3).toFixed(3)}ms  p99 ${(j.latencyPercentiles.p99*1e3).toFixed(3)}ms  cpu/req ${(cpu/n*1e6).toFixed(2)}µs  rss ${(+process.env.RSS/1024).toFixed(0)}MB`)'
  kill $PID; wait $PID 2>/dev/null || true
}
ON="MODE=native BUN_OTEL=1 BUN_OTEL_INSTRUMENTATIONS=http,fetch"
runone "main (no telemetry)" "$BASE" MODE=none
runone "branch off" "$BUN" MODE=none
runone "branch on" "$BUN" $ON
runone "branch on, exp1 no wrapper" "$BUN" $ON BUN_OTEL_EXP=1
runone "branch on, exp2 no attrs" "$BUN" $ON BUN_OTEL_EXP=2
runone "branch on, exp4 no client.addr" "$BUN" $ON BUN_OTEL_EXP=4
runone "branch on, exp8 no end/record" "$BUN" $ON BUN_OTEL_EXP=8
runone "branch on, exp15 all off" "$BUN" $ON BUN_OTEL_EXP=15
runone "main + otel-js sdk" "$BASE" MODE=sdk
