#!/bin/bash
set -u
D=/workspace/heapgrowth/workloads/servers
BUN=/workspace/bun/build/release/bun

start() {
  LIVE_MB=150 "$@" 2>/tmp/e >/dev/null &
  SPID=$!
  PORT=""
  for i in $(seq 1 100); do PORT=$(grep -oP '^LISTEN \K[0-9]+' /tmp/e 2>/dev/null); [ -n "$PORT" ] && break; sleep 0.1; done
}
stop() { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null; }

for srv in bun node; do
  if [ "$srv" = bun ]; then start "$BUN" "$D/app-express.js"; else start node "$D/app-express.js"; fi
  echo "=== server=$srv :$PORT ==="
  for c in 1 4 16 64 128 256; do
    R=$("$BUN" "$D/loadgen.ts" "$PORT" 6 "$c" 2>&1 >/dev/null)
    RPS=$(echo "$R" | grep -oP '"rps":\K[0-9]+')
    echo "  c=$c rps=$RPS"
  done
  stop
done
