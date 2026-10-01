#!/usr/bin/env bash
# One hold of the lock. Release build: the test file of three trees, twice with the data pages of the corpus out of the page cache and five times with them in it.
#   repo   the tree as committed, with the prototype binding of the notes (round2/prototype)
#   kp     repo with the two optional changes of the runner (the option lookup, the zero options as a literal); the whole-corpus test stays
#   after  repo with the change of this research unit: the whole-corpus test leaves the file, two tests of the list come, the sweep holds the enumerator against the list
# Debug build of the worktree: what the file does while its describe blocks are read, and the whole file of repo and of after.
# usage: /workspace/tools/lk bash batch2.sh
set -u
B=/tmp/rtb1b
out=$B/out2
H=test/cli/lint/conformance
TIMEFORMAT='TIME wall %R s user %U s sys %S s'
one() { # <tree> <label>
  local tree=$1 label=$2 log=$out/$2.log
  ( cd $B/$tree && { time USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts ; } > $log 2>&1 )
  echo "$label load $(cut -d' ' -f1 /proc/loadavg): $(grep -E '^ *[0-9]+ (pass|fail|skip)' $log | tr -s ' \n' ' ') $(grep -E '^Ran ' $log) $(grep '^TIME' $log)"
}
echo "### $(date -u +%FT%TZ) release $(bun --revision), cold: the data pages of the corpus are put out of the page cache before each run"
for k in 1 2; do
  for tree in repo kp after; do python3 $B/probe/evict.py $B/$tree/$H/corpus > /dev/null; one $tree $tree-cold$k; done
done
echo "### warm: the three corpora are read once before"
for tree in repo kp after; do find $B/$tree/$H/corpus -type f -exec cat {} + > /dev/null; done
for k in 1 2 3 4 5; do
  for tree in repo kp after; do one $tree $tree-warm$k; done
done
D=/workspace/wt/conformance/build/debug/bun-debug
echo "### $(date -u +%FT%TZ) debug build $($D --revision 2>/dev/null), the changed tree: while the describe blocks are read"
( cd $B/after && BUN_DEBUG_QUIET_LOGS=1 $D $B/probe/describe-time.ts $B/after/$H ) > $out/debug-describe-time.log 2>&1
cut -c1-150 $out/debug-describe-time.log
for tree in repo after; do
  echo "### $(date -u +%FT%TZ) debug build, the whole file of $tree, --timeout 180000"
  ( cd $B/$tree && { time BUN_DEBUG_QUIET_LOGS=1 $D test test/cli/lint/conformance.test.ts --timeout 180000 ; } > $out/debug-$tree.log 2>&1 )
  echo "debug-$tree: $(grep -E '^ *[0-9]+ (pass|fail|skip)' $out/debug-$tree.log | tr -s ' \n' ' ') $(grep -E '^Ran ' $out/debug-$tree.log) $(grep '^TIME' $out/debug-$tree.log)"
done
echo "### $(date -u +%FT%TZ) done"
