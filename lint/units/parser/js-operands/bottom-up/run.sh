#!/bin/sh
# Reproduces every number of the js-operands research (bottom-up). Read-only on the worktree.
# BUN: the base release build of the worktree (e3566be889). TS: typescript 6.0.2. GO: the parse oracle of
# typescript-go 89d5d5b, built by ../../ledger/tsgo-oracle/build.sh. V8: node with vm modules.
set -e
cd "$(dirname "$0")"
BUN=${BUN:-/workspace/wt/parser/build/release/bun}
TS=${TS:-/workspace/wt/parser/node_modules/typescript/lib/typescript.js}
GO=${GO:-/tmp/rr/parsediag}
WT=/workspace/wt/parser
REF=/workspace/ref/typescript-go
# 1. Every JavaScript file of the repository: loader js against ts, jsx against tsx, js against jsx.
# The four summaries below are kept in corpus-diff.summary.txt.
$BUN diff-js-ts.mjs corpus-diff.jsonl $WT/test $WT/src/js
$BUN diff-js-ts.mjs nm-diff.jsonl $WT/test $WT/node_modules --node-modules
# 2. The same with minified identifiers: the output then depends on the symbols and on the scope tree.
$BUN diff-js-ts-minify.mjs /tmp/js-operands.corpus-minify.jsonl $WT/test $WT/src/js
$BUN diff-js-ts-minify.mjs /tmp/js-operands.nm-minify.jsonl $WT/test $WT/node_modules --node-modules
$BUN classify.mjs corpus-diff.jsonl js-rejects-ts-accepts
$BUN pattern-count.mjs $WT/test $WT/src/js > pattern-count.txt
# 3. The JavaScript units of the conformance cases (compiler and conformance directories).
$BUN conf-js.mjs $TS $REF/_submodules/TypeScript/tests/cases conf-js.jsonl "{compiler,conformance}/**" > conf-js.txt
$BUN conf-js-files.mjs $REF/_submodules/TypeScript/tests/cases > conf-js-files.txt
# 4. Baselines that hold a TS8xxx code.
python3 ts8-count.py $REF/_submodules/TypeScript/tests/baselines/reference $REF/testdata/baselines/reference/submodule \
  $REF/testdata/baselines/reference/compiler $REF/testdata/baselines/reference/conformance > ts8-count.txt
python3 ts8-baselines.py > ts8-baselines.txt
# 5. How often the benchmark inputs reach the sites in question.
node site-count.cjs $TS /workspace/notes/lint/benchroot > site-count.txt
node paren-count.cjs $TS /workspace/notes/lint/benchroot/bench/react-hello-world/react-hello-world.node.js
# 6. Targeted inputs: base bun (four loaders), tsc 6.0.2 (six file kinds, V8 validity), typescript-go.
cd targeted
$BUN bun-run.mjs > bun.json
node --experimental-vm-modules tsc-run.mjs $TS > tsc.json 2>/dev/null
$BUN tsgo-run.mjs $GO > tsgo.json
$BUN report.mjs > report.txt
$BUN expected.mjs > expected.txt
node tsc-checkjs.mjs $TS
