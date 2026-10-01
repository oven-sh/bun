#!/usr/bin/env bash
# usage: scratch.sh <directory> [--prototype]
# Makes a clone of the conformance branch that shares the objects of /workspace/bun, checks out only what
# test/cli/lint/conformance.test.ts needs, and writes the corpus into it with sync.sh. Nothing in the unit's
# worktree changes. With --prototype the glue of round2/prototype is laid over the runner, with which the test
# file passes (release: 105 pass; debug: 104 pass, 1 skip).
# Run the test of the scratch clone with the build of the worktree:
#   cd <directory> && BUN_DEBUG_QUIET_LOGS=1 /workspace/tools/lk /workspace/wt/conformance/build/debug/bun-debug test test/cli/lint/conformance.test.ts
set -euo pipefail
dir=${1:?usage: scratch.sh <directory> [--prototype]}
notes=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
rev=$(git -C /workspace/wt/conformance rev-parse HEAD)
git clone -q --shared --no-checkout /workspace/bun "$dir"
cd "$dir"
git sparse-checkout init --no-cone
git sparse-checkout set '/test/cli/lint/' '/test/harness.ts' '/test/preload.ts' '/test/_util/' '/test/tsconfig.json' \
  '/test/bunfig.toml' '/test/leaksan.supp' '/tsconfig.base.json' '/bunfig.toml' '/package.json' '/.gitignore' \
  '/.gitattributes' '/.prettierrc' '/.prettierignore' '/scripts/runner.node.ts' '/LICENSE.md' '/docs/project/license.mdx'
git checkout -q --detach "$rev"
home=test/cli/lint/conformance
if [ ! -f "$home/UPSTREAM" ]; then cp "$notes/corpus-layout-and-sync/top-down/prototype/UPSTREAM" "$home/UPSTREAM"; fi
bash "$home/sync.sh" /workspace/ref/typescript-go /workspace/ref/typescript-go/_submodules/TypeScript | tail -4
if [ "${2:-}" = --prototype ]; then
  if [ ! -f "$home/runner/corpus.ts" ]; then
    cp "$notes/round2/prototype/corpus.ts" "$home/runner/corpus.ts"
    git apply "$notes/round2/prototype/index.ts.patch"
  fi
  if [ ! -f "$home/expectations.json" ]; then cp "$notes/round2/prototype/expectations.json" "$home/expectations.json"; fi
fi
echo "scratch clone at $dir, commit $rev"
