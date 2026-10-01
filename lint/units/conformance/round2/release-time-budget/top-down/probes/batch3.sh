#!/usr/bin/env bash
# One hold of the lock. The changed tree as it is proposed (after: the named cases are in the sample), release build: two cold and five warm runs beside the tree as committed (repo).
# Then runners with one rule broken, in both trees: which tests of "enumerator" fail. Then the debug build on the tests of "reference" and "enumerator" of the changed tree.
# usage: /workspace/tools/lk bash batch3.sh
set -u
B=/tmp/rtb1b
out=$B/out3
H=test/cli/lint/conformance
TIMEFORMAT='TIME wall %R s user %U s sys %S s'
one() { # <tree> <label> [bun test arguments]
  local tree=$1 label=$2 log=$out/$2.log
  shift 2
  ( cd $B/$tree && { time USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts "$@" ; } > $log 2>&1 )
  echo "$label load $(cut -d' ' -f1 /proc/loadavg): $(grep -E '^ *[0-9]+ (pass|fail|skip)' $log | tr -s ' \n' ' ') $(grep -E '^Ran ' $log) $(grep '^TIME' $log)"
}
echo "### $(date -u +%FT%TZ) release $(bun --revision), cold"
for k in 1 2; do
  for tree in repo after; do python3 $B/probe/evict.py $B/$tree/$H/corpus > /dev/null; one $tree $tree-cold$k; done
done
echo "### warm"
for tree in repo after; do find $B/$tree/$H/corpus -type f -exec cat {} + > /dev/null; done
for k in 1 2 3 4 5; do
  for tree in repo after; do one $tree $tree-warm$k; done
done
echo "### a runner with one rule broken: the tests of enumerator that fail"
mutate() { # <tree> <name> <file> <sed script>
  local tree=$1 name=$2 file=$B/$1/$H/runner/$3
  cp $file $file.keep
  sed -i "$4" $file
  if cmp -s $file $file.keep; then echo "$name: the sed script changed nothing in $3"; fi
  one $tree $tree-broken-$name -t "^enumerator "
  grep -E "^\(fail\)" $out/$tree-broken-$name.log | cut -c1-150 | sed 's/^/    /'
  mv $file.keep $file
}
for tree in repo after; do
  mutate $tree umd harnessutil_options.ts '264d'
  mutate $tree node10 harnessutil_options.ts '269d'
  mutate $tree interop harnessutil_options.ts '273d'
  mutate $tree star harnessutil_variations.ts '96s/if (star \&\& allValues.length > 0)/if (false \&\& allValues.length > 0)/'
  mutate $tree utf16 vfs.ts '25d'
  mutate $tree extends tsconfig.ts 's/  if (ownConfig.extendedConfigPath !== undefined) {/  if (false as boolean) {/'
  ( cd $B/$tree && git status --short $H/runner | grep -v corpus.ts | grep -v index.ts )
done
D=/workspace/wt/conformance/build/debug/bun-debug
echo "### $(date -u +%FT%TZ) debug build, the changed tree: reference and enumerator, --timeout 180000"
( cd $B/after && { time BUN_DEBUG_QUIET_LOGS=1 $D test test/cli/lint/conformance.test.ts -t "^(reference|enumerator) " --timeout 180000 ; } > $out/debug-after-ref-enum.log 2>&1 )
grep -E "^\((pass|fail|skip)\)|^ *[0-9]+ (pass|fail|skip)|^Ran |^TIME" $out/debug-after-ref-enum.log | cut -c1-170
echo "### $(date -u +%FT%TZ) done"
