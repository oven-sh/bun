#!/usr/bin/env bash
# One hold of the lock: batch1.sh on a tree, then what the change moved out of the test file and what it needs besides:
# the sweep that holds every case against the list, the type check of the files, and `bun --lint` itself under the leak check.
# usage: /workspace/tools/lk bash batch2.sh <tree> <out directory> [label]
set -u
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
tree=$(cd -- "$1" && pwd)
out=$2
label=${3:-tree}
bash "$here/batch1.sh" "$tree" "$out" "$label"
TIMEFORMAT='TIME wall %R s user %U s sys %S s'
echo "### $(date -u +%FT%TZ) $label: sweep.ts --no-run, every case against the list"
( cd "$tree" && { time bun test/cli/lint/conformance/sweep.ts --no-run; } > "$out/$label-sweep-no-run.txt" 2>&1; echo "exit $?" >> "$out/$label-sweep-no-run.txt" )
tail -5 "$out/$label-sweep-no-run.txt"
echo "### $(date -u +%FT%TZ) $label: type check"
bash "$here/../../../typecheck.sh" "$tree" 2>&1 | tail -5
echo "### $(date -u +%FT%TZ) bun --lint itself under the leak check and the exception checks"
bash "$here/lint-leak.sh"
echo "### $(date -u +%FT%TZ) done"
