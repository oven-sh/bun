#!/bin/sh
# Reproduces the numbers of the js-operands research (top-down). Read-only on the worktree.
# BUN: the base release build (e3566be889). tsc: typescript 6.0.2 of the worktree. GO: the parse oracle of
# typescript-go 89d5d5b, built by ../../ledger/tsgo-oracle/build.sh (needed by targeted-tsgo.mjs and ts8-spans.mjs).
set -e
cd "$(dirname "$0")"
BUN=${BUN:-/workspace/wt/parser/build/release/bun}
GO=${GO:-/tmp/rr/parsediag}
WT=/workspace/wt/parser
W=${W:-/tmp/jsop}
mkdir -p "$W/chunks"
# 1. Every .js .mjs .cjs .jsx file under test/ (node_modules apart) and src/js: the four loaders, four configurations.
(cd $WT && find test -path '*/node_modules' -prune -o -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.jsx' \) -print; \
 cd $WT && find src/js -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.jsx' \)) | sort | sed "s#^#$WT/#" > "$W/list.repo.txt"
(cd $WT && find test -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.jsx' \) -path '*/node_modules/*') | sort | sed "s#^#$WT/#" > "$W/list.nm.txt"
cat "$W/list.repo.txt" "$W/list.nm.txt" > "$W/list.all.txt"
rm -f "$W"/chunks/*
split -l 400 -d -a 3 "$W/list.repo.txt" "$W/chunks/repo."
split -l 1000 -d -a 3 "$W/list.nm.txt" "$W/chunks/nm."
for cfg in parse dce default minify; do
  mkdir -p "$W/out-$cfg"
  for c in "$W"/chunks/*; do CFG=$cfg $BUN corpus-worker.mjs "$c" "$W/out-$cfg/$(basename "$c").jsonl"; done
  echo "== CFG=$cfg"; $BUN corpus-digest.mjs "$W/out-$cfg"/*.jsonl
done
echo "== CFG=parse, outside node_modules"; $BUN corpus-digest.mjs "$W/out-parse"/repo.*.jsonl
# 2. The same files through tsc's parser, joined with bun's acceptance under the loader of the file.
node corpus-tsc.cjs "$W/list.all.txt" "$W/tsc.all.jsonl"
$BUN corpus-join.mjs "$W/tsc.all.jsonl" "$W/out-parse"/*.jsonl
# 3. Targeted inputs: bun (four loaders), tsc 6.0.2 and typescript-go (six file names), causes, expectations.
$BUN targeted-bun.mjs > targeted-bun.jsonl
node targeted-tsc.cjs > targeted-tsc.jsonl 2>/dev/null
$BUN targeted-tsgo.mjs "$GO" > targeted-tsgo.jsonl
$BUN targeted-digest.mjs > targeted-results.txt
$BUN targeted-digest.mjs --all > targeted-results.all.txt
$BUN targeted-oracles.mjs > targeted-oracles.txt
$BUN targeted-causes.mjs --list > targeted-causes.txt
# 4. Spans of the diagnostics for TypeScript-only syntax in a JavaScript file, header pragmas, the arrow pairs.
$BUN ts8-spans.mjs "$GO" > ts8-spans.txt
node pragmas-js.cjs > pragmas-js.txt
$BUN conf-arrow.mjs > conf-arrow.txt
python3 ts8-to-bun-errors.py > ts8-to-bun-errors.txt
# 5. How often the JavaScript benchmark input reads `(` in prefix position.
node paren-sites.cjs /workspace/notes/lint/benchroot/bench/react-hello-world/react-hello-world.node.js > paren-sites.txt
