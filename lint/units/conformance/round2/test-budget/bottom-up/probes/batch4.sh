#!/usr/bin/env bash
# One hold of the machine lock: the tree as the glue leaves it (repo) and the tree with the knobs, turn by turn at one load, release (installed bun):
# three cold and three warm runs each. Then the knobs tree without the tests of "default check", which start the processes: what the rest costs.
set -u
B=/tmp/test-budget-1a
out=$B/out/batch4
mkdir -p "$out"
H=test/cli/lint/conformance
T=test/cli/lint/conformance.test.ts
TIMEFORMAT='TIME real %R user %U sys %S'
state() { echo "load $(cut -d' ' -f1-3 /proc/loadavg) cpu.pressure $(head -1 /sys/fs/cgroup/cpu.pressure | cut -d' ' -f2-3) disk $(df -h / | tail -1 | awk '{print $4}')"; }
one() { # <tree> <label> <command...>
  local tree=$1 label=$2 log=$out/$2.log
  shift 2
  ( cd $B/$tree && echo "STATE $(state)" && { time "$@" ; } ; echo "exit $?" ) > $log 2>&1
  echo "$label | $(grep -m1 '^STATE' $log | cut -c7-) | $(grep -E '^ *[0-9]+ (pass|fail|skip)' $log | tr -s ' \n' ' ')| $(grep -E '^Ran ' $log) | $(grep '^TIME' $log) | $(grep -m1 '^exit' $log)"
}
echo "### $(date -u +%FT%TZ) start; $(state)"
echo "### cold: the data pages of the corpus are put out of the page cache before each run"
for k in 1 2 3; do
  for tree in repo knobs; do python3 $B/probes/evict.py $B/repo/$H/corpus > /dev/null; one $tree $tree-cold-$k env USE_SYSTEM_BUN=1 bun test $T; done
done
echo "### warm"
find $B/repo/$H/corpus -type f -print0 | xargs -0 cat > /dev/null
for k in 1 2 3; do
  for tree in repo knobs; do one $tree $tree-warm-$k env USE_SYSTEM_BUN=1 bun test $T; done
done
echo "### the knobs tree without the tests that start processes"
for k in 1 2; do one knobs knobs-noproc-$k env USE_SYSTEM_BUN=1 bun test $T -t '^(?!default check )'; done
echo "### $(date -u +%FT%TZ) done; $(state)"
