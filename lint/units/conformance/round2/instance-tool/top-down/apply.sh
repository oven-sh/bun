#!/usr/bin/env bash
# usage: apply.sh <tree>
# Lays the prototype of E5 as a mode of sweep.ts (--lines, --names) over a tree that holds the conformance runner of
# 3110ce85cf with the binding of ../../runner-corpus-binding/top-down (its apply.sh) laid over it: a scratch clone of
# ../../scratch.sh, or the worktree. It patches runner/run.ts, runner/index.ts, runner/expectations.ts, sweep.ts and
# conformance.test.ts, and writes the two check fixtures. Over the binding of ../../runner-corpus-binding/bottom-up the one
# hunk of the imports of sweep.ts is laid by hand: its sweep.ts does not import the type Corpus yet.
set -euo pipefail
tree=$(cd -- "${1:?usage: apply.sh <tree>}" && pwd)
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
home=$tree/test/cli/lint/conformance
(cd "$tree" && patch -p1 -s < "$here/e5-lines.patch")
cp "$here/replay-check-fixture.ts" "$here/empty-check-fixture.ts" "$home/fixtures/"
echo "E5 (sweep.ts --lines) laid over $tree"
