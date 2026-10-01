#!/usr/bin/env bash
# One hold of the machine lock: the release runs with the times of every start and end of a test, to find the time that no test holds.
set -u
B=/tmp/test-budget-1a
out=$B/out/batch3
mkdir -p "$out"
T=test/cli/lint/conformance.test.ts
TIMEFORMAT='TIME real %R user %U sys %S'
find $B/repo/test/cli/lint/conformance/corpus -type f -print0 | xargs -0 cat > /dev/null
for tree in repo knobs; do
  for k in 1 2; do
    log=$out/$tree-timeline-$k.log
    ( cd $B/$tree && echo "STATE load $(cut -d' ' -f1-3 /proc/loadavg)" && { time env USE_SYSTEM_BUN=1 TIMELINE_OUT=$out/$tree-timeline-$k.json bun test --preload $B/probes/timeline-preload.ts $T ; } ; echo "exit $?" ) > $log 2>&1
    echo "$tree-timeline-$k | $(grep -m1 '^STATE' $log) | $(grep -E '^Ran ' $log) | $(grep '^TIME' $log)"
    bun $B/probes/timeline-show.ts $out/$tree-timeline-$k.json $log 100
  done
done
echo "### $(date -u +%FT%TZ) done"
