#!/usr/bin/env bash
# usage: apply.sh <tree>
# Lays the binding of this directory over a tree that holds the conformance runner as committed at 3110ce85cf: a scratch
# clone of ../scratch.sh (without --prototype), or the worktree. It writes runner/corpus.ts and expectations.json,
# and patches runner/index.ts and sweep.ts. conformance.test.ts is not touched.
set -euo pipefail
tree=$(cd -- "${1:?usage: apply.sh <tree>}" && pwd)
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
home=$tree/test/cli/lint/conformance
cp "$here/corpus.ts" "$home/runner/corpus.ts"
cp "$here/expectations.json" "$home/expectations.json"
git -C "$tree" apply "$here/index.ts.patch" "$here/sweep.ts.patch"
echo "binding laid over $tree"
