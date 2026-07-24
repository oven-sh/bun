#!/bin/bash
# oha-driven node-vs-bun comparison on the same handler.
set -u
cd /workspace/heapgrowth/workloads/servers
CLK_TCK=$(getconf CLK_TCK)

readstat() { # <pid> -> echoes "utime stime"
  local L; read -r L < "/proc/$1/stat" 2>/dev/null || { echo "0 0"; return; }
  local R="${L##*) }"
  echo "$R" | awk '{print $12, $13}'
}

run1() { # <label> <cmd...>
  local label="$1"; shift
  "$@" >/tmp/srv.out 2>/tmp/srv.err &
  local PID=$!
  local PORT=""
  for i in $(seq 1 300); do
    PORT=$(grep -oP '^LISTEN \K[0-9]+' /tmp/srv.err 2>/dev/null | head -1)
    [ -n "$PORT" ] && break
    kill -0 "$PID" 2>/dev/null || { echo "{\"label\":\"$label\",\"error\":\"died\"}"; cat /tmp/srv.err >&2; return; }
    sleep 0.1
  done
  oha -z 2s -c 64 --no-tui --output-format quiet "http://127.0.0.1:$PORT/api/1?k=v" >/dev/null 2>&1
  read -r U0 S0 < <(readstat "$PID")
  local OHA
  OHA=$(oha -z 15s -c 64 --no-tui --output-format json "http://127.0.0.1:$PORT/api/1?k=v" 2>/dev/null)
  read -r U1 S1 < <(readstat "$PID")
  local RSS=$(awk '/^VmHWM:/{print $2}' "/proc/$PID/status")
  kill -TERM "$PID" 2>/dev/null; wait "$PID" 2>/dev/null
  local CPU_MS=$(( (U1 - U0 + S1 - S0) * 1000 / CLK_TCK ))
  local RPS REQS P50 P99
  RPS=$(echo "$OHA" | jq -r '.summary.requestsPerSec | floor' 2>/dev/null)
  REQS=$(echo "$OHA" | jq -r '[.statusCodeDistribution | to_entries[].value] | add' 2>/dev/null)
  P50=$(echo "$OHA" | jq -r '(.latencyPercentiles.p50 // 0) * 1000000 | floor' 2>/dev/null)
  P99=$(echo "$OHA" | jq -r '(.latencyPercentiles.p99 // 0) * 1000000 | floor' 2>/dev/null)
  : "${RPS:=0}"; : "${REQS:=1}"; : "${P50:=0}"; : "${P99:=0}"
  local CPU_US_REQ=0
  [ "$REQS" -gt 0 ] && CPU_US_REQ=$(( CPU_MS * 1000 / REQS ))
  printf '{"label":"%s","rps":%s,"reqs":%s,"p50_us":%s,"p99_us":%s,"cpu_s":%s,"cpu_us_req":%s,"rss_mb":%d}\n' \
    "$label" "$RPS" "$REQS" "$P50" "$P99" $((CPU_MS/1000)) "$CPU_US_REQ" $((RSS/1024))
}

echo "=== LIVE_MB=150 ==="
for wl in express fastify nodehttp; do
  for rep in 1 2; do
    LIVE_MB=150 run1 "node-$wl-r$rep" node app-$wl.js
    LIVE_MB=150 run1 "bun-$wl-r$rep"  /workspace/bun/build/release/bun app-$wl.js
  done
done

echo "=== LIVE_MB=1 (tiny heap) ==="
for wl in express fastify nodehttp; do
  LIVE_MB=1 run1 "node-$wl-tiny" node app-$wl.js
  LIVE_MB=1 run1 "bun-$wl-tiny"  /workspace/bun/build/release/bun app-$wl.js
done
