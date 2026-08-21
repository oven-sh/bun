#!/usr/bin/env bash
# Usage: ./run.sh <bun-binary> [baseline-bun-binary]
#
# Bun.serve tracing overhead. The server is pinned to one core and driven to
# saturation by oha from other cores; each configuration is run REPS times,
# interleaved, and the median req/s and server CPU-time per request reported.
set -euo pipefail
BUN=${1:-bun}
BASE=${2:-$BUN}
DUR=${DUR:-10s}
CONC=${CONC:-64}
AWAITS=${AWAITS:-2}
REPS=${REPS:-3}
SERVER_CPU=${SERVER_CPU:-4}
LOAD_CPUS=${LOAD_CPUS:-8-23}
here=$(cd "$(dirname "$0")" && pwd)
PORT=$((20000 + RANDOM % 20000))
COLLECTOR_PORT=$((PORT + 1))
TCK=$(getconf CLK_TCK)
out=$(mktemp -d)

COLLECTOR_PORT=$COLLECTOR_PORT taskset -c 30 $BUN "$here/collector.js" 2>/dev/null & COL=$!
trap 'kill $COL 2>/dev/null || true; rm -rf $out' EXIT
sleep 0.3

cputicks() { awk '{print $14+$15}' /proc/$1/stat; }

runone() {
  local key=$1 bin=$2; shift 2
  env "$@" PORT=$PORT AWAITS=$AWAITS OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:$COLLECTOR_PORT nice -n -15 taskset -c $SERVER_CPU "$bin" "$here/server.js" 2>>$out/$key.err & local PID=$!
  sleep 0.5
  nice -n -15 taskset -c $LOAD_CPUS oha -z 3s -c $CONC --no-tui http://localhost:$PORT/bench >/dev/null 2>&1
  local t0=$(cputicks $PID)
  perf stat -x, -e instructions:u,cycles:u -p $PID -o $out/perf.csv -- nice -n -15 taskset -c $LOAD_CPUS oha -z $DUR -c $CONC --no-tui --output-format json http://localhost:$PORT/bench 2>/dev/null > $out/oha.json
  local t1=$(cputicks $PID)
  local rss=$(awk '/VmRSS/{print $2}' /proc/$PID/status)
  local ins=$(awk -F, '/instructions/{print $1}' $out/perf.csv) cyc=$(awk -F, '/cycles/{print $1}' $out/perf.csv)
  TICKS=$((t1-t0)) TCK=$TCK RSS=$rss INS=$ins CYC=$cyc bun -e 'const j=await Bun.file(process.argv[1]).json(); const n=Object.values(j.statusCodeDistribution).reduce((a,b)=>a+b,0); const cpu=+process.env.TICKS/+process.env.TCK; console.log(JSON.stringify({rps:j.summary.requestsPerSec, p50:j.latencyPercentiles.p50*1e3, p99:j.latencyPercentiles.p99*1e3, cpu:cpu/n*1e6, rss:+process.env.RSS/1024, ins:+process.env.INS/n, cyc:+process.env.CYC/n}))' $out/oha.json >> $out/$key.jsonl
  kill $PID; wait $PID 2>/dev/null || true
}

CONFIGS=(
  "main|$BASE|MODE=none"
  "branch-off|$BUN|MODE=none"
  "branch-on|$BUN|MODE=native BUN_OTEL=1 BUN_OTEL_INSTRUMENTATIONS=http,fetch"
  "main+sdk|$BASE|MODE=sdk"
)
for ((r = 0; r < REPS; r++)); do
  for c in "${CONFIGS[@]}"; do
    IFS='|' read -r key bin envs <<<"$c"
    runone $key $bin $envs
  done
done
printf "%-14s %10s %9s %9s %10s %10s %10s %7s   (median of %d, AWAITS=%d, %s x c%d)\n" config req/s p50 p99 cpu/req instr/req cycles/req rss $REPS $AWAITS $DUR $CONC
for c in "${CONFIGS[@]}"; do
  IFS='|' read -r key bin envs <<<"$c"
  bun -e '
    const rows = (await Bun.file(process.argv[1]).text()).trim().split("\n").map(JSON.parse);
    const med = k => { const v = rows.map(r => r[k]).sort((a,b)=>a-b); return v[v.length >> 1]; };
    console.log(`${process.argv[2].padEnd(14)} ${med("rps").toFixed(0).padStart(10)} ${med("p50").toFixed(3).padStart(7)}ms ${med("p99").toFixed(3).padStart(7)}ms ${med("cpu").toFixed(2).padStart(8)}µs ${med("ins").toFixed(0).padStart(10)} ${med("cyc").toFixed(0).padStart(10)} ${med("rss").toFixed(0).padStart(5)}MB`);
  ' $out/$key.jsonl $key
done
grep -h "otel stats" $out/branch-on.err | tail -1 || true
