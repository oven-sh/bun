#!/usr/bin/env bash
# One hold of the lock: the change on a tree with the binding of runner-corpus-binding/top-down (tb), release build, one run as found and three after.
set -u
B=/tmp/rtb1b
out=$B/out4
mkdir -p $out
TIMEFORMAT='TIME wall %R s user %U s sys %S s'
for k in 1 2 3 4; do
  ( cd $B/tb && { time USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts ; } > $out/tb-$k.log 2>&1 )
  echo "tb-$k load $(cut -d' ' -f1 /proc/loadavg): $(grep -E '^ *[0-9]+ (pass|fail|skip)' $out/tb-$k.log | tr -s ' \n' ' ') $(grep -E '^Ran ' $out/tb-$k.log) $(grep '^TIME' $out/tb-$k.log)"
done
grep -E "^\(fail\)" $out/tb-*.log | head
