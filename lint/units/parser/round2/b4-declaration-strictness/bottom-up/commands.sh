#!/bin/sh
# How the files of this directory were made (research for B4, declarations: TS2880, TS1357, TS1260, class members, parameters, heritage).
# Nothing here writes in a worktree. Tree: /workspace/wt/parser at be1ebe5295.
# Oracles: tsc 6.0.2 (node_modules/typescript of the worktree), typescript-go 89d5d5b as /tmp/rr/parsediag-bu
# (ledger/bottom-up/tsgo-oracle/build.sh builds it), the lint parse of the head as /tmp/smph/out/bun_js_parser
# (round2/strict-members-params-heritage/bottom-up/build-probe.sh builds it from a scratch copy of the crate with zz_probe.rs).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
P=/workspace/notes/lint/units/parser/round2/strict-members-params-heritage/bottom-up
BUN=${BUN:-/workspace/wt/parser/build/release/bun}
S=${S:-/tmp/b4decl}
mkdir -p "$S"
cd "$HERE"
for n in assert enum esc seed v; do
  node mk-$n.cjs > $n.json
  (cd "$P" && "$BUN" probe.cjs "$HERE/$n.json" --hex "$S/$n.hex" > /dev/null)
  SMPH_INPUTS="$S/$n.hex" SMPH_OUT="$S/$n.lint.tsv" /tmp/smph/out/bun_js_parser zz_probe > /dev/null 2>&1 || true
  (cd "$P" && "$BUN" probe.cjs "$HERE/$n.json" --go /tmp/rr/parsediag-bu --lint "$S/$n.lint.tsv" > "$S/$n.out.txt" && node condense.cjs "$S/$n.out.txt") > $n.condensed.txt
  # rows of a Rust table with the first diagnostic of typescript-go, and a mark for what the head does (see rows.cjs)
  node rows.cjs $n.json "$S/$n.lint.tsv" > $n.rows.txt
done
# the 898 inputs of the older research, as rows with marks
node rows.cjs "$P/targeted.json" /tmp/smph/lint.targeted.tsv > targeted.rows.be1ebe5295.txt
# counts by class over the outputs of the older research: code, range and text compared
node classify2.cjs "$P/results/targeted.out.txt" --sections
# the diagnostics of the checker of tsc for enum members that its parser takes
node tsc-all.cjs 'enum E { 1 }' 'enum E { 1n }' 'enum E { #a }' 'enum E { [x] }'
