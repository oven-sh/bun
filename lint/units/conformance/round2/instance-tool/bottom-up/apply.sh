#!/usr/bin/env bash
# usage: apply.sh <tree>
# Lays the prototype of E5 over a tree that holds the conformance runner of 3110ce85cf with the binding of
# ../../runner-corpus-binding/top-down (its apply.sh) laid over it: a scratch clone of ../../scratch.sh, or the worktree.
# It writes runner/command.ts, instances.ts and the two check fixtures, and patches runner/run.ts, runner/index.ts, sweep.ts
# and conformance.test.ts.
set -euo pipefail
tree=$(cd -- "${1:?usage: apply.sh <tree>}" && pwd)
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
home=$tree/test/cli/lint/conformance
git -C "$tree" apply "$here/e5.patch"
cp "$here/command.ts" "$home/runner/command.ts"
cp "$here/instances.ts" "$home/instances.ts"
cp "$here/replay-check-fixture.ts" "$here/empty-check-fixture.ts" "$home/fixtures/"
echo "E5 laid over $tree"
