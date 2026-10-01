#!/usr/bin/env bash
# usage: apply.sh <tree> [--status-skip]
# Lays the binding of this directory over a tree that holds the conformance runner as committed at 3110ce85cf: a scratch
# clone of ../../scratch.sh (without --prototype), or the worktree. It writes runner/corpus.ts and expectations.json (lists
# that are there stay), and patches runner/index.ts, sweep.ts and runner/run.ts (the third status of Instance); a patch
# that is in the tree already is left. conformance.test.ts is not touched.
# With --status-skip runner/run.ts stays as it is and corpus.status-skip.ts is laid: an instance that the reference fails
# then has the status "skip", no skipReason and its invalidReason.
set -euo pipefail
tree=$(cd -- "${1:?usage: apply.sh <tree> [--status-skip]}" && pwd)
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
home=$tree/test/cli/lint/conformance
patches="index.ts.patch sweep.ts.patch run.ts.patch"
corpus=corpus.ts
if [ "${2:-}" = --status-skip ]; then patches="index.ts.patch sweep.ts.patch"; corpus=corpus.status-skip.ts; fi
cp "$here/$corpus" "$home/runner/corpus.ts"
[ -f "$home/expectations.json" ] || cp "$here/expectations.json" "$home/expectations.json"
for patch in $patches; do
  if git -C "$tree" apply --reverse --check "$here/$patch" 2> /dev/null; then
    echo "$patch is in the tree already"
  else
    git -C "$tree" apply "$here/$patch"
  fi
done
echo "binding laid over $tree"
