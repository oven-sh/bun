#!/bin/bash
# Usage: measure-server.sh <label> <cwd> <server-cmd...>
# Starts server under logGC, waits for "LISTEN <port>" on stderr, drives load
# for DURATION (default 15s) at CONCURRENCY (default 64), kills server, reports.
set -u

LABEL="$1"; shift
CWD="$1"; shift
if [ "$1" = "--" ]; then shift; fi

DURATION="${DURATION:-15}"
CONCURRENCY="${CONCURRENCY:-64}"
# Loadgen + parser run in a clean env so unknown BUN_JSC_* on whatever bun they
# use don't spray warnings into their output.
BUN=(env -u BUN_JSC_minEdenToOldGenerationRatio -u BUN_JSC_heapGrowthMaxIncrease -u BUN_JSC_heapGrowthSteepnessFactor -u BUN_JSC_smallHeapGrowthFactor -u BUN_JSC_forceRAMSize -u BUN_JSC_logGC /workspace/bun/build/release/bun)
GCLOG=$(mktemp)
OUTLOG=$(mktemp)
LOADLOG=$(mktemp)
CLK_TCK=$(getconf CLK_TCK)

(
  cd "$CWD" || exit 127
  exec env BUN_JSC_logGC=1 "$@" >"$OUTLOG" 2>"$GCLOG"
) &
PID=$!

# Wait for LISTEN <port>
PORT=""
for i in $(seq 1 300); do
  PORT=$(grep -oP '^LISTEN \K[0-9]+' "$GCLOG" 2>/dev/null | head -1)
  [ -n "$PORT" ] && break
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.1
done
if [ -z "$PORT" ]; then
  kill -KILL "$PID" 2>/dev/null
  wait "$PID" 2>/dev/null
  echo "{\"label\":\"$LABEL\",\"error\":\"no LISTEN\",\"stderr\":$(jq -Rs . <"$GCLOG" | head -c 2000)}"
  rm -f "$GCLOG" "$OUTLOG" "$LOADLOG"
  exit 1
fi

# Record warmup stats then start polling + load
PEAK_RSS_KB=0
UTIME=0; STIME=0
poll() {
  if [ -r "/proc/$PID/status" ]; then
    V=$(awk '/^VmHWM:/{print $2}' "/proc/$PID/status" 2>/dev/null)
    [ -n "$V" ] && PEAK_RSS_KB=$V
  fi
  if [ -r "/proc/$PID/stat" ]; then
    read -r LINE < "/proc/$PID/stat" 2>/dev/null || true
    REST="${LINE##*) }"
    set -- $REST
    UTIME=${12:-$UTIME}; STIME=${13:-$STIME}
  fi
}
poll
UTIME0=$UTIME; STIME0=$STIME
START_NS=$(date +%s%N)

# Drive load in background; poll server proc meanwhile
"${BUN[@]}" /workspace/heapgrowth/workloads/servers/loadgen.ts "$PORT" "$DURATION" "$CONCURRENCY" 2>"$LOADLOG" &
LOADPID=$!
while kill -0 "$LOADPID" 2>/dev/null; do poll; sleep 0.02; done
wait "$LOADPID"
poll

END_NS=$(date +%s%N)
kill -TERM "$PID" 2>/dev/null
for i in $(seq 1 50); do kill -0 "$PID" 2>/dev/null || break; sleep 0.05; done
kill -KILL "$PID" 2>/dev/null
wait "$PID" 2>/dev/null

WALL_MS=$(( (END_NS - START_NS) / 1000000 ))
USER_MS=$(( (UTIME - UTIME0) * 1000 / CLK_TCK ))
SYS_MS=$(( (STIME - STIME0) * 1000 / CLK_TCK ))

GC_JSON=$("${BUN[@]}" /workspace/heapgrowth/parse-gclog.ts < "$GCLOG")
LOAD_JSON=$(grep '^{' "$LOADLOG" | tail -1)
: "${LOAD_JSON:=null}"

printf '{"label":"%s","wall_ms":%d,"user_ms":%d,"sys_ms":%d,"peak_rss_kb":%d,"load":%s,"gc":%s}\n' \
  "$LABEL" "$WALL_MS" "$USER_MS" "$SYS_MS" "$PEAK_RSS_KB" "$LOAD_JSON" "$GC_JSON"

if [ -n "${KEEP_LOGS:-}" ]; then
  mkdir -p "$KEEP_LOGS"
  cp "$GCLOG" "$KEEP_LOGS/$LABEL.gclog"
  cp "$OUTLOG" "$KEEP_LOGS/$LABEL.stdout"
fi
rm -f "$GCLOG" "$OUTLOG" "$LOADLOG"
