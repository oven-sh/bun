#!/bin/bash
# Runs under the machine lock, once: the test file of three trees with the installed release bun, warm and cold.
# V0 = /tmp/rtb1a/repo (the runner as committed, with the binding), V1 = /tmp/rtb1a/after (the three changes of the runner),
# V3 = /tmp/rtb1a/v3 (the changes of the runner, and the whole corpus out of the test file). The corpus is one directory for all three.
out=/tmp/rtb1a/out/batch
mkdir -p "$out"
corpus=/tmp/rtb1a/repo/test/cli/lint/conformance/corpus
export TIMEFORMAT='TIME real %R user %U sys %S'
warm() { find "$corpus" -type f -print0 | xargs -0 cat > /dev/null; }
run() { # tree tag
  ( cd "$1" && echo "loadavg $(cat /proc/loadavg)" && time USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts; echo "exit $?" ) > "$out/$2.log" 2>&1
}
echo "start $(date +%T)" > "$out/progress"
warm
for k in 1 2 3 4 5; do
  run /tmp/rtb1a/repo  V0-warm-$k
  run /tmp/rtb1a/after V1-warm-$k
  run /tmp/rtb1a/v3    V3-warm-$k
  echo "warm round $k done $(date +%T)" >> "$out/progress"
done
for t in repo:V0 after:V1 v3:V3; do
  tree=/tmp/rtb1a/${t%%:*}; tag=${t##*:}
  ( cd "$tree" && PERCPU_OUT=$out/$tag-percpu.json USE_SYSTEM_BUN=1 bun test --preload /tmp/rtb1a/probes/percpu-preload.ts test/cli/lint/conformance.test.ts ) > "$out/$tag-percpu.log" 2>&1
done
echo "percpu done $(date +%T)" >> "$out/progress"
for k in 1 2; do
  for t in repo:V0 after:V1 v3:V3; do
    tree=/tmp/rtb1a/${t%%:*}; tag=${t##*:}
    python3 /tmp/rtb1a/probes/evict.py "$corpus" > /dev/null
    run "$tree" $tag-cold-$k
  done
  echo "cold round $k done $(date +%T)" >> "$out/progress"
done
echo "end $(date +%T)" >> "$out/progress"
