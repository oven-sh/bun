#!/bin/bash
# Under the machine lock, once: the test file of the final prototype (V3) with the installed release bun, page cache warm, three runs; then once with the page cache of the corpus dropped.
out=/tmp/rtb1a/out/batch4
mkdir -p "$out"
corpus=/tmp/rtb1a/repo/test/cli/lint/conformance/corpus
find "$corpus" -type f -print0 | xargs -0 cat > /dev/null
export TIMEFORMAT='TIME real %R user %U sys %S'
for k in 1 2 3; do
  ( cd /tmp/rtb1a/v3 && echo "loadavg $(cat /proc/loadavg)" && time USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts; echo "exit $?" ) > "$out/V3-final-warm-$k.log" 2>&1
done
python3 /tmp/rtb1a/probes/evict.py "$corpus" > /dev/null
( cd /tmp/rtb1a/v3 && echo "loadavg $(cat /proc/loadavg)" && time USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts; echo "exit $?" ) > "$out/V3-final-cold-1.log" 2>&1
echo "end $(date +%T)" > "$out/progress"
