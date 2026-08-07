#!/bin/bash
# safe-run.sh <max-seconds> <cmd...> — run cmd in its own process group; kill the whole group at the deadline
# or immediately if more than MAX_CLI (default 6) processes named `cli` exist at any point. Never leaves children behind.
MAX=${1:?secs}; shift; MAX_CLI=${MAX_CLI:-6}
if [ "$(pgrep -x "cli|cli-imagetest" | wc -l)" -gt "$MAX_CLI" ]; then echo "[safe-run] refusing: $(pgrep -x "cli|cli-imagetest" | wc -l) cli processes already running" >&2; exit 99; fi
set -m; "$@" & PID=$!; PGID=$(ps -o pgid= -p $PID | tr -d ' ')
( T0=$SECONDS; while kill -0 $PID 2>/dev/null; do
    if [ $((SECONDS-T0)) -ge $MAX ]; then echo "[safe-run] deadline ${MAX}s: killing group $PGID" >&2; kill -9 -- -$PGID 2>/dev/null; pkill -9 -x cli; pkill -9 -x cli-imagetest 2>/dev/null; break; fi
    if [ "$(pgrep -x "cli|cli-imagetest" | wc -l)" -gt "$MAX_CLI" ]; then echo "[safe-run] cli count exceeded $MAX_CLI: killing everything named cli + group $PGID" >&2; kill -9 -- -$PGID 2>/dev/null; pkill -9 -x cli; pkill -9 -x cli-imagetest; break; fi
    sleep 1; done ) &
WD=$!; wait $PID; RC=$?; kill $WD 2>/dev/null; kill -9 -- -$PGID 2>/dev/null; exit $RC
