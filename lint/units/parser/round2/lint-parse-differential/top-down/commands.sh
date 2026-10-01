#!/bin/sh
# How the files of results/ were made: what a LINT parse of be1ebe5295 accepts and rejects over the two corpora of grammar-diff/, against
# typescript-go 89d5d5b (the reference of the port) and tsc 6.0.2 (grammar-diff/oracle.*.jsonl.gz). Nothing here writes in the worktree.
# Needs: the target directory that `cargo test -p bun_js_parser --lib` left in /workspace/wt/parser, node, tsc 6.0.2 in the node_modules
# of the worktree, and parsediag-bu of typescript-go (ledger/bottom-up/tsgo-oracle/build.sh builds it; /tmp/rr/parsediag-bu).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
S=${S:-/tmp/lpd1b}
G=/workspace/notes/lint/units/parser/grammar-diff
GO=${GO:-/tmp/rr/parsediag-bu}
mkdir -p "$S" "$HERE/results"
# 1. the probe: one rustc of one crate, through the lock (about 3 minutes once it has the lock)
[ -x "$S/scratch/out/bun_js_parser" ] || /workspace/tools/lk sh "$HERE/build-probe.sh" /workspace/wt/parser "$S/scratch"
PROBE=${PROBE:-$S/scratch/out/bun_js_parser}
# 2. the inputs (<index> <ts|tsx> <hex>) and the reference
for c in targeted small; do
  node "$HERE/mkhex.cjs" "$G/corpus.$c.json" "$G/oracle.$c.jsonl.gz" "$S/$c"
  node "$HERE/go-oracle.cjs" "$GO" "$G/corpus.$c.json" "$S/$c"
done
# 3. the lint parse of every source, as ts and as tsx: plain (the options of the tests of the crate), tla, lint (the options of `bun --lint`).
#    One process, 20 s for the 209,628 sources of corpus.small.
run() { c=$1; k=$2; cfg=$3; shift 3; env "$@" SMPH_INPUTS="$S/$c.$k.hex" SMPH_OUT="$S/$c.$k.$cfg.tsv" "$PROBE" zz_probe > "$S/$c.$k.$cfg.log" 2>&1; }
for c in targeted small; do for k in ts tsx; do
  run $c $k plain A=1
  run $c $k tla SMPH_TLA=1
  run $c $k lint SMPH_TLA=1 SMPH_STANDARD_DECORATORS=1
done; done
# 4. the join and the three classes
for c in targeted small; do for k in ts tsx; do for cfg in plain tla lint; do
  node "$HERE/join.cjs" "$G/oracle.$c.jsonl.gz" "$S/$c.go.$k.jsonl" "$S/$c.meta.jsonl" "$S/$c.$k.$cfg.tsv" $k "$S/$c.$k.$cfg.join.jsonl"
done; done; done > "$HERE/results/counts.txt"
cd "$S"
F="small.ts.lint.join.jsonl small.tsx.lint.join.jsonl small.ts.plain.join.jsonl small.tsx.plain.join.jsonl targeted.ts.lint.join.jsonl targeted.tsx.lint.join.jsonl targeted.ts.plain.join.jsonl targeted.tsx.plain.join.jsonl"
# what tsc as a whole says about the sources of class 1: a copy of the oracle module of grammar-diff-oracle-and-causes beside harness.mjs
mkdir -p "$S/gd" && cp /workspace/notes/lint/units/parser/grammar-diff-oracle-and-causes/for-grammar-diff/oracle.mjs "$G/harness.mjs" "$S/gd/"
node "$HERE/chk.mjs" "$S/gd/oracle.mjs" "$S/chk.jsonl" $(ls *.join.jsonl)
node "$HERE/families.cjs" chk.jsonl $F --examples=3 > "$HERE/results/class1.reference-parses.lint-rejects.txt"
node "$HERE/gaps.cjs" $F --examples=2 > "$HERE/results/class2.lint-parses.reference-rejects.txt"
node "$HERE/both-reject.cjs" small.ts.lint.join.jsonl small.tsx.lint.join.jsonl targeted.ts.lint.join.jsonl targeted.tsx.lint.join.jsonl --examples=2 > "$HERE/results/class3.both-reject.txt"
for c in targeted small; do for k in ts tsx; do node "$HERE/godiff.cjs" $c $k; done; done > "$HERE/results/typescript-go-against-tsc.txt"
