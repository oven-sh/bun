#!/bin/bash
# Round 3, R4: the 366 rows of test/bundler/transpiler/typescript-grammar*.test.ts, what main and tsc do with each, the Rust
# tables that replace them and the lists for API.md. Nothing here writes in the worktree. Each step is light: one process.
# usage: bash run.sh            (the four test files must still be in the worktree for step 1; rows.json is their copy)
set -eu
H=$(cd "$(dirname "$0")" && pwd)
N=/workspace/notes/lint/units/parser
BASE=${BASE:-/workspace/base/bun.f4d755a9c}
HEAD=${HEAD:-/workspace/bun/build/release/bun}
export GD=${GD:-/tmp/tkd/gd}
cd "$H"

# The differential harness of round 2 with its oracle and its cause list laid over it, as run.sh of round2/a1-differential did.
if [ ! -s "$GD/causes.mjs" ]; then
  mkdir -p "$(dirname "$GD")"
  rm -rf "$GD"
  cp -r "$N/grammar-diff" "$GD"
  cp -r "$N/grammar-diff-oracle-and-causes/for-grammar-diff/"* "$GD/"
  ln -sfn "$N/probes" "$(dirname "$GD")/probes"
fi

# 1. The rows. Skipped when the test files are gone: rows.json stays.
if ls /workspace/wt/parser/test/bundler/transpiler/typescript-grammar*.test.ts > /dev/null 2>&1; then node extract-rows.mjs | tail -1; fi

# 2. main, the release build of round 1, and tsc on each row.
"$BASE" side.mjs rows.json runs/main.f4d755a9c.json
"$HEAD" side.mjs rows.json runs/head.23a20afa7.json
node tsc-rows.mjs rows.json runs/tsc.json

# 3. Classes and causes, then what tsc builds for each row.
bun classify.mjs
# gen/erased.cjs is sidecar-erased-statements/top-down/oracle.cjs as a module; gen/facts.mjs also reads probes/p3-3-wrappers-and-parentheses/oracle.cjs.
node gen/facts.mjs
node gen/check-families.mjs

# 4. The Rust tables, the rows for `bun --lint`, the lists for API.md.
node gen/rust.mjs
node gen/lint-command.mjs

# 5. The corpora of round 2 with main of today, for the counts of the lists. Needs the harness: about ten seconds.
if [ "${CORPORA:-0}" = 1 ]; then
  R=$N/grammar-diff-oracle-and-causes/runs
  (cd "$GD" && bun gen.mjs targeted > /dev/null && cp "$R/corpus.testrows.json" "$R/corpus.small-sub.json" .)
  for c in testrows targeted small-sub; do
    (cd "$GD" && "$BASE" harness.mjs "corpus.$c.json" "$H/runs/base.$c.jsonl.gz" --jobs=4 && "$HEAD" harness.mjs "corpus.$c.json" "$H/runs/head.$c.jsonl.gz" --jobs=4)
  done
  "$BASE" valid-plain.mjs runs/valid-plain.main.json | head -1
fi
bun corpus-lists.mjs > runs/corpus-lists.txt
node lists.mjs "$@"
