#!/bin/sh
# Timing under the heavy lock: no other build or test runs meanwhile, as for the real sweep.
echo "### lock acquired: $(date -u +%FT%TZ)"
D=/workspace/wt/conformance/build/debug/bun-debug
R=/tmp/conf-wb-1b/bun-release-be1ebe529
cd /tmp/conf-wb-1b
cat /sys/fs/cgroup/cpu.pressure | head -1
bun timing.ts $D none
bun timing.ts $D leak
bun timing.ts $R none
cd /tmp/conf-wb-1b/scratch
for pair in "debug $D" "release $R"; do
  set -- $pair
  s0=$(date +%s%N)
  bun test/cli/lint/conformance/sweep.ts --bin $2 --jobs 4 --report /tmp/conf-wb-1b/locked-$1.json conformance/statements/ > /tmp/conf-wb-1b/locked-sweep-$1.txt 2>&1
  rc=$?
  s1=$(date +%s%N)
  echo "sweep conformance/statements/ (318 run instances) $1 jobs=4: wall $(( (s1-s0)/1000000 )) ms = $(( (s1-s0)/1000000/318 )) ms per instance; exit=$rc; $(grep -E '^by outcome' /tmp/conf-wb-1b/locked-sweep-$1.txt | tr '\n' ';')"
done
cat /sys/fs/cgroup/cpu.pressure | head -1
echo "### finished: $(date -u +%FT%TZ)"
