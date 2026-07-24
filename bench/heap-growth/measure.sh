#!/bin/bash
# Usage: measure.sh <label> <cwd> -- <cmd...>
# Env: any BUN_JSC_* set by caller is forwarded. Adds BUN_JSC_logGC=1.
# If MEASURE_DURATION=<sec> is set, SIGTERM the child after that many seconds
# (for server workloads); otherwise wait for natural exit.
# Outputs one JSON line to stdout. KEEP_LOGS=<dir> saves raw logs.

set -u

LABEL="$1"; shift
CWD="$1"; shift
if [ "$1" = "--" ]; then shift; fi

GCLOG=$(mktemp)
OUTLOG=$(mktemp)
CLK_TCK=$(getconf CLK_TCK)
BUN=/workspace/bun/build/release/bun

(
  cd "$CWD" || exit 127
  exec env BUN_JSC_logGC=1 "$@" >"$OUTLOG" 2>"$GCLOG"
) &
PID=$!
START_NS=$(date +%s%N)

PEAK_RSS_KB=0
UTIME=0; STIME=0; CUTIME=0; CSTIME=0
DEADLINE=""
[ -n "${MEASURE_DURATION:-}" ] && DEADLINE=$(( $(date +%s) + MEASURE_DURATION ))

while kill -0 "$PID" 2>/dev/null; do
  if [ -r "/proc/$PID/status" ]; then
    V=$(awk '/^VmHWM:/{print $2}' "/proc/$PID/status" 2>/dev/null)
    [ -n "$V" ] && PEAK_RSS_KB=$V
  fi
  if [ -r "/proc/$PID/stat" ]; then
    read -r LINE < "/proc/$PID/stat" 2>/dev/null || true
    REST="${LINE##*) }"
    # shellcheck disable=SC2086
    set -- $REST
    UTIME=${12:-$UTIME}; STIME=${13:-$STIME}; CUTIME=${14:-$CUTIME}; CSTIME=${15:-$CSTIME}
  fi
  if [ -n "$DEADLINE" ] && [ "$(date +%s)" -ge "$DEADLINE" ]; then
    kill -TERM "$PID" 2>/dev/null
    DEADLINE=""
  fi
  sleep 0.01
done

wait "$PID"
EC=$?
END_NS=$(date +%s%N)
WALL_MS=$(( (END_NS - START_NS) / 1000000 ))
USER_MS=$(( (UTIME + CUTIME) * 1000 / CLK_TCK ))
SYS_MS=$(( (STIME + CSTIME) * 1000 / CLK_TCK ))

GC_JSON=$("$BUN" /workspace/heapgrowth/parse-gclog.ts < "$GCLOG")

printf '{"label":"%s","wall_ms":%d,"user_ms":%d,"sys_ms":%d,"peak_rss_kb":%d,"exit":%d,"gc":%s}\n' \
  "$LABEL" "$WALL_MS" "$USER_MS" "$SYS_MS" "$PEAK_RSS_KB" "$EC" "$GC_JSON"

if [ -n "${KEEP_LOGS:-}" ]; then
  mkdir -p "$KEEP_LOGS"
  cp "$GCLOG" "$KEEP_LOGS/$LABEL.gclog"
  cp "$OUTLOG" "$KEEP_LOGS/$LABEL.stdout"
fi
rm -f "$GCLOG" "$OUTLOG"
