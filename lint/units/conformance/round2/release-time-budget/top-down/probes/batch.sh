#!/usr/bin/env bash
# One hold of the lock: the test file of the tree as committed (repo) and of the changed tree (after), release build, then what the change costs a debug build.
# usage: /workspace/tools/lk bash batch.sh
set -u
B=/tmp/rtb1b
out=$B/out
H=test/cli/lint/conformance
TIMEFORMAT='TIME wall %R s user %U s sys %S s'
one() { # <tree> <label>
  local tree=$1 label=$2 log=$out/$2.log
  ( cd $B/$tree && { time USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts ; } > $log 2>&1 )
  echo "$label load $(cut -d' ' -f1 /proc/loadavg): $(grep -E '^ *[0-9]+ (pass|fail|skip)' $log | tr -s ' \n' ' ') $(grep -E '^Ran ' $log) $(grep '^TIME' $log)"
}
echo "### $(date -u +%FT%TZ) as found"
one repo before-asfound
one after after-asfound
echo "### cold: the data pages of the corpus are put out of the page cache before each run"
for k in 1 2; do
  python3 $B/probe/evict.py $B/repo/$H/corpus > /dev/null; one repo before-cold$k
  python3 $B/probe/evict.py $B/after/$H/corpus > /dev/null; one after after-cold$k
done
echo "### warm: both corpora are read once before"
for tree in repo after; do find $B/$tree/$H/corpus -type f -exec cat {} + > /dev/null; done
for k in 1 2 3 4 5; do
  one repo before-warm$k
  one after after-warm$k
done
echo "### debug build, the changed tree: the parts of the tests of the list"
( cd $B/after && BUN_DEBUG_QUIET_LOGS=1 /workspace/wt/conformance/build/debug/bun-debug $B/probe/list-tests.ts $B/after/$H ) > $out/debug-list-parts.log 2>&1
cat $out/debug-list-parts.log | cut -c1-160
echo "### debug build, the changed tree: the tests of the list alone"
( cd $B/after && { time BUN_DEBUG_QUIET_LOGS=1 /workspace/wt/conformance/build/debug/bun-debug test test/cli/lint/conformance.test.ts -t "the list has|the corpus has the oracle|the corpus holds" ; } > $out/debug-list-tests.log 2>&1 )
grep -E "^\(pass\)|^\(fail\)|^ *[0-9]+ (pass|fail|skip)|^Ran |^TIME|error" $out/debug-list-tests.log | cut -c1-220
echo "### $(date -u +%FT%TZ) done"
