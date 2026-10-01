#!/usr/bin/env bash
# One hold of the lock: a tree whose test file starts the binary under test (the patch of default-check-classification is in it),
# so the release build is one that has --lint; then the release build once more, cold, on a second tree.
# usage: /workspace/tools/lk bash batch3.sh <tree> <out directory> <label> <release build with --lint> [<second tree> <its label>]
set -u
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$here/modes.sh"
tree=$(cd -- "$1" && pwd)
out=$2
label=$3
lint=$4
mkdir -p "$out"
H=$tree/test/cli/lint/conformance
echo "### $(date -u +%FT%TZ) $label: release $("$lint" --revision), cold, then warm twice"
python3 "$here/evict.py" "$H/corpus" "$H/fixtures" "$H/runner"
REL=$lint run_mode release "$tree" "$out/$label-release-cold.log"; summary "$label release cold" "$out/$label-release-cold.log"
for k in 1 2; do
  REL=$lint run_mode release "$tree" "$out/$label-release-warm$k.log"; summary "$label release warm$k" "$out/$label-release-warm$k.log"
done
REL=$lint run_mode release-ci "$tree" "$out/$label-release-ci.log"; summary "$label release-ci" "$out/$label-release-ci.log"
slowest "$out/$label-release-ci.log" 6
if [ $# -ge 6 ]; then
  second=$(cd -- "$5" && pwd)
  echo "### $(date -u +%FT%TZ) $6: release $(bun --revision), cold twice"
  for k in 1 2; do
    python3 "$here/evict.py" "$second/test/cli/lint/conformance/corpus" "$second/test/cli/lint/conformance/fixtures" "$second/test/cli/lint/conformance/runner"
    run_mode release "$second" "$out/$6-release-cold$k.log"; summary "$6 release cold$k" "$out/$6-release-cold$k.log"
  done
fi
echo "### $(date -u +%FT%TZ) $label: debug $("$DBG" --revision 2>/dev/null | tail -1)"
for mode in debug debug-leak debug-ci; do
  run_mode $mode "$tree" "$out/$label-$mode.log"; summary "$label $mode" "$out/$label-$mode.log"
  slowest "$out/$label-$mode.log" 10
done
echo "### $(date -u +%FT%TZ) done"
