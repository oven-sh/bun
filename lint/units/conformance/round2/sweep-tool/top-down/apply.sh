#!/usr/bin/env bash
# usage: apply.sh <tree> [--glue]
# Lays the prototype of the sweep tool (pass 1b, top-down) over a tree that holds the conformance runner of 3110ce85cf:
# a scratch clone of ../../scratch.sh, or the worktree. Without --glue: sweep-tool.patch (sweep.ts, runner/expectations.ts,
# describe("sweep.ts") at the end of conformance.test.ts, the three check fixtures). With --glue the tree has the binding of
# ../../corpus-glue/bottom-up laid over it (its apply.sh): lay.py edits that sweep.ts in place, and the describe and the
# fixtures are taken from the patch. prettier of the worktree formats sweep.ts after lay.py.
set -euo pipefail
tree=$(cd -- "${1:?usage: apply.sh <tree> [--glue]}" && pwd)
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
home=$tree/test/cli/lint/conformance
if [ "${2:-}" = --glue ]; then
  python3 "$here/lay.py" "$tree" --glue
  /workspace/wt/conformance/node_modules/.bin/prettier --write "$home/sweep.ts" > /dev/null
  (cd "$tree" && git apply --include='test/cli/lint/conformance.test.ts' --include='test/cli/lint/conformance/fixtures/*' "$here/sweep-tool.patch")
else
  (cd "$tree" && git apply "$here/sweep-tool.patch")
fi
echo "sweep tool laid over $tree"
