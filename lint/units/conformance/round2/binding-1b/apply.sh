#!/usr/bin/env bash
# usage: apply.sh <tree>
# Lays the binding of this directory over a tree that holds the conformance runner as committed at 3110ce85cf: a scratch
# clone of ../scratch.sh (without --prototype), or the worktree. It writes runner/corpus.ts and expectations.json (the
# lists that are there stay), and patches runner/index.ts and sweep.ts; a patch that is in the tree already is left.
# conformance.test.ts is not touched.
set -euo pipefail
tree=$(cd -- "${1:?usage: apply.sh <tree>}" && pwd)
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
home=$tree/test/cli/lint/conformance
cp "$here/corpus.ts" "$home/runner/corpus.ts"
[ -f "$home/expectations.json" ] || cp "$here/expectations.json" "$home/expectations.json"
for patch in index.ts.patch sweep.ts.patch; do
  if git -C "$tree" apply --reverse --check "$here/$patch" 2> /dev/null; then
    echo "$patch is in the tree already"
  else
    git -C "$tree" apply "$here/$patch"
  fi
done
echo "binding laid over $tree"
