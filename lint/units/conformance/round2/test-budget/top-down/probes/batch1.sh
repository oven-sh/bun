#!/usr/bin/env bash
# One hold of the lock: the test file of a tree in every way in which it must pass.
# usage: [REL=<release build>] /workspace/tools/lk bash batch1.sh <tree> <out directory> [label]
set -u
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$here/modes.sh"
tree=$(cd -- "$1" && pwd)
out=$2
label=${3:-tree}
mkdir -p "$out"
H=$tree/test/cli/lint/conformance
echo "### $(date -u +%FT%TZ) $label: release $("$REL" --revision), cold: the data pages of the corpus and the fixtures are put out of the page cache"
python3 "$here/evict.py" "$H/corpus" "$H/fixtures" "$H/runner"
run_mode release "$tree" "$out/$label-release-cold.log"; summary "$label release cold" "$out/$label-release-cold.log"
for k in 1 2; do
  run_mode release "$tree" "$out/$label-release-warm$k.log"; summary "$label release warm$k" "$out/$label-release-warm$k.log"
done
run_mode release-ci "$tree" "$out/$label-release-ci.log"; summary "$label release-ci" "$out/$label-release-ci.log"
run_mode release-ci-exact "$tree" "$out/$label-release-ci-exact.log"; summary "$label release-ci-exact" "$out/$label-release-ci-exact.log"
echo "### $(date -u +%FT%TZ) $label: debug $("$DBG" --revision 2>/dev/null | tail -1)"
for mode in debug debug-leak debug-ci; do
  run_mode $mode "$tree" "$out/$label-$mode.log"; summary "$label $mode" "$out/$label-$mode.log"
  slowest "$out/$label-$mode.log" 14
done
echo "### $(date -u +%FT%TZ) done"
