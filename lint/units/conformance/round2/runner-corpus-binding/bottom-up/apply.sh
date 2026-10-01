#!/usr/bin/env bash
# usage: apply.sh <tree>   (a scratch clone of ../../scratch.sh, without --prototype)
# Lays the binding over the runner of a tree at commit 3110ce85cf: runner/corpus.ts, the four lines of runner/index.ts,
# sweep.ts without its own copy of the glue, and expectations.json with two empty lists. With the corpus in place
# test/cli/lint/conformance.test.ts then gives 105 pass (release) or 104 pass and 1 skip (debug), and compare.sh
# shows that sweep.ts prints what it printed before.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
tree=$(cd -- "${1:?usage: apply.sh <tree>}" && pwd)
home=$tree/test/cli/lint/conformance
cp "$here/corpus.ts" "$home/runner/corpus.ts"
git -C "$tree" apply "$here/index-and-sweep.patch"
if [ ! -f "$home/expectations.json" ]; then cp "$here/../../prototype/expectations.json" "$home/expectations.json"; fi
echo "applied to $tree"
