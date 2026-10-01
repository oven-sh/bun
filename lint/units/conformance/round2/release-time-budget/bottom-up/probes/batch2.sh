#!/bin/bash
# Under the machine lock, once: the test file of the three trees with the preload that meters every test, twice each, page cache warm.
out=/tmp/rtb1a/out/batch3
mkdir -p "$out"
corpus=/tmp/rtb1a/repo/test/cli/lint/conformance/corpus
find "$corpus" -type f -print0 | xargs -0 cat > /dev/null
export TIMEFORMAT='TIME real %R user %U sys %S'
for k in 1 2 3; do
  for t in repo:V0 after:V1 v3:V3; do
    tree=/tmp/rtb1a/${t%%:*}; tag=${t##*:}
    ( cd "$tree" && echo "loadavg $(cat /proc/loadavg)" && time PERCPU_OUT=$out/$tag-percpu-$k.json USE_SYSTEM_BUN=1 bun test --preload /tmp/rtb1a/probes/percpu-preload.ts test/cli/lint/conformance.test.ts; echo "exit $?" ) > "$out/$tag-percpu-$k.log" 2>&1
  done
done
echo "end $(date +%T)" > "$out/progress"
