#!/bin/bash
# Under the lock: the cost probe with the debug build of the worktree, twice, and once with the release build.
cd /tmp/rh1a || exit 1
echo "got the lock $(date -u +%H:%M:%S), loadavg $(cat /proc/loadavg)"
for k in 1 2; do
  echo "== debug build, run $k"
  ( time env BUN_DEBUG_QUIET_LOGS=1 /workspace/wt/conformance/build/debug/bun-debug probes/debug-cost.ts /tmp/rh1a/repo ) 2>&1
done
echo "== release build"
( time bun probes/debug-cost.ts /tmp/rh1a/repo ) 2>&1
echo "done $(date -u +%H:%M:%S)"
