#!/bin/bash
# Probe with loadgen CPU measurement and write-pattern check.
set -u
cd /workspace/heapgrowth/workloads/servers
CLK_TCK=$(getconf CLK_TCK)
CLIENT_BUN="${CLIENT_BUN:-/workspace/bun/build/release/bun}"
SERVER_BUN="${SERVER_BUN:-/workspace/bun/build/release/bun}"

readcpu() { read -r L < "/proc/$1/stat"; R="${L##*) }"; echo "$R" | awk '{print $12+$13}'; }

probe() { # <label> <server-cmd...>
  local label="$1"; shift
  LIVE_MB="${LIVE_MB:-150}" "$@" 2>/tmp/e &
  local SPID=$!
  local PORT=""
  for i in $(seq 1 100); do PORT=$(grep -oP '^LISTEN \K[0-9]+' /tmp/e); [ -n "$PORT" ] && break; sleep 0.1; done

  # warmup
  "$CLIENT_BUN" /workspace/heapgrowth/workloads/servers/loadgen.ts "$PORT" 2 64 2>/dev/null

  "$CLIENT_BUN" /workspace/heapgrowth/workloads/servers/loadgen.ts "$PORT" 10 64 2>/tmp/load &
  local LPID=$!
  sleep 0.5
  local SCPU0=$(readcpu "$SPID"); local LCPU0=$(readcpu "$LPID")
  local SCPU1=$SCPU0; local LCPU1=$LCPU0
  while kill -0 "$LPID" 2>/dev/null; do
    SCPU1=$(readcpu "$SPID" 2>/dev/null || echo "$SCPU1")
    LCPU1=$(readcpu "$LPID" 2>/dev/null || echo "$LCPU1")
    sleep 0.05
  done
  wait "$LPID"

  local LOAD=$(cat /tmp/load)
  local REQS=$(echo "$LOAD" | jq -r .reqs)
  local RPS=$(echo "$LOAD" | jq -r .rps)
  local SCPU_MS=$(( (SCPU1 - SCPU0) * 1000 / CLK_TCK ))
  local LCPU_MS=$(( (LCPU1 - LCPU0) * 1000 / CLK_TCK ))
  printf '{"label":"%s","rps":%s,"reqs":%s,"server_cpu_ms":%d,"client_cpu_ms":%d,"server_us_req":%d,"client_us_req":%d}\n' \
    "$label" "$RPS" "$REQS" "$SCPU_MS" "$LCPU_MS" $((SCPU_MS*1000/REQS)) $((LCPU_MS*1000/REQS))

  kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null
}

echo "client=$CLIENT_BUN server_bun=$SERVER_BUN LIVE_MB=${LIVE_MB:-150}"
probe "bun-express"  "$SERVER_BUN" app-express.js
probe "node-express" node           app-express.js
