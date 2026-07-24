#!/bin/bash
# Like measure-server.sh but without BUN_JSC_logGC (for Node / generic runtimes).
set -u
LABEL="$1"; shift
CWD="$1"; shift
if [ "$1" = "--" ]; then shift; fi

DURATION="${DURATION:-15}"
CONCURRENCY="${CONCURRENCY:-64}"
BUN=/workspace/bun/build/release/bun
GCLOG=$(mktemp); OUTLOG=$(mktemp); LOADLOG=$(mktemp)
CLK_TCK=$(getconf CLK_TCK)

( cd "$CWD" || exit 127; exec "$@" >"$OUTLOG" 2>"$GCLOG" ) &
PID=$!

PORT=""
for i in $(seq 1 300); do
  PORT=$(grep -oP '^LISTEN \K[0-9]+' "$GCLOG" 2>/dev/null | head -1)
  [ -n "$PORT" ] && break
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.1
done
if [ -z "$PORT" ]; then
  kill -KILL "$PID" 2>/dev/null; wait "$PID" 2>/dev/null
  echo "{\"label\":\"$LABEL\",\"error\":\"no LISTEN\"}"
  cat "$GCLOG" >&2
  rm -f "$GCLOG" "$OUTLOG" "$LOADLOG"; exit 1
fi

PEAK_RSS_KB=0; UTIME=0; STIME=0
poll() {
  if [ -r "/proc/$PID/status" ]; then
    V=$(awk '/^VmHWM:/{print $2}' "/proc/$PID/status" 2>/dev/null)
    [ -n "$V" ] && PEAK_RSS_KB=$V
  fi
  if [ -r "/proc/$PID/stat" ]; then
    read -r LINE < "/proc/$PID/stat" 2>/dev/null || true
    REST="${LINE##*) }"; set -- $REST
    UTIME=${12:-$UTIME}; STIME=${13:-$STIME}
  fi
}
poll; UTIME0=$UTIME; STIME0=$STIME
START_NS=$(date +%s%N)
"$BUN" /workspace/heapgrowth/workloads/servers/loadgen.ts "$PORT" "$DURATION" "$CONCURRENCY" 2>"$LOADLOG" &
LOADPID=$!
while kill -0 "$LOADPID" 2>/dev/null; do poll; sleep 0.02; done
wait "$LOADPID"; poll
END_NS=$(date +%s%N)
kill -TERM "$PID" 2>/dev/null
for i in $(seq 1 50); do kill -0 "$PID" 2>/dev/null || break; sleep 0.05; done
kill -KILL "$PID" 2>/dev/null; wait "$PID" 2>/dev/null

WALL_MS=$(( (END_NS - START_NS) / 1000000 ))
USER_MS=$(( (UTIME - UTIME0) * 1000 / CLK_TCK ))
SYS_MS=$(( (STIME - STIME0) * 1000 / CLK_TCK ))
LOAD_JSON=$(tail -1 "$LOADLOG"); : "${LOAD_JSON:=null}"

printf '{"label":"%s","wall_ms":%d,"user_ms":%d,"sys_ms":%d,"peak_rss_kb":%d,"load":%s}\n' \
  "$LABEL" "$WALL_MS" "$USER_MS" "$SYS_MS" "$PEAK_RSS_KB" "$LOAD_JSON"
rm -f "$GCLOG" "$OUTLOG" "$LOADLOG"
