#!/bin/bash
# Probe: while bun-fetch loadgen is running, sample socket states to see
# whether connections are being reused or churned.
set -u
cd /workspace/heapgrowth/workloads/servers
BUN=/workspace/bun/build/release/bun

probe_against() { # <server-label> <server-cmd...>
  local label="$1"; shift
  LIVE_MB="${LIVE_MB:-1}" "$@" 2>/tmp/e &
  local PID=$!
  local PORT=""
  for i in $(seq 1 50); do PORT=$(grep -oP '^LISTEN \K[0-9]+' /tmp/e); [ -n "$PORT" ] && break; sleep 0.1; done
  echo "=== $label server on :$PORT ==="

  "$BUN" /workspace/heapgrowth/workloads/servers/loadgen.ts "$PORT" 8 64 2>/tmp/load &
  local LPID=$!
  sleep 2
  echo "--- ss -tan (client-side, dport=$PORT) ---"
  ss -tan "( dport = :$PORT )" | awk 'NR>1{print $1}' | sort | uniq -c
  echo "--- ss -tan (server-side, sport=$PORT) ---"
  ss -tan "( sport = :$PORT )" | awk 'NR>1{print $1}' | sort | uniq -c
  wait "$LPID"
  echo "--- loadgen result ---"
  cat /tmp/load
  kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null
  echo
}

echo "######## LIVE_MB=$LIVE_MB ########"
probe_against "bun-express"  "$BUN" app-express.js
probe_against "node-express" node  app-express.js
