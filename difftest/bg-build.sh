#!/bin/sh
# Debug build of the checked-out head in the background. Writes a marker when the binary is ready.
cd /workspace/bun || exit 1
head=$(git rev-parse --short=10 HEAD)
echo "build of $head started $(date -u +%FT%TZ)" > /tmp/arc/bd.started
BUN_DEBUG_QUIET_LOGS=1 bun scripts/build.ts --profile=debug --quiet > /tmp/arc/bd.log 2>&1
rc=$?
if [ $rc -eq 0 ] && [ "$(git rev-parse --short=10 HEAD)" = "$head" ] && [ -z "$(git status --porcelain -- src packages)" ]; then
  echo "candidate $head built $(date -u +%FT%TZ)" > /tmp/arc/CANDIDATE_DEBUG_BUILD
else
  echo "build rc=$rc head-now=$(git rev-parse --short=10 HEAD) at $(date -u +%FT%TZ)" > /tmp/arc/bd.failed
fi
