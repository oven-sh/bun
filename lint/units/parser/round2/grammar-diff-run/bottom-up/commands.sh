#!/bin/sh
# A1, the differential run of the release builds. Nothing here writes into the worktree.
# Binaries: /workspace/notes/lint/measure/parser/base/bun (e3566be889) and head/bun (the head under test).
# Scratch: /tmp/gdr1a (gd = a copy of ../../../grammar-diff with the files of ../../../grammar-diff-oracle-and-causes/for-grammar-diff
# copied over it, plus gd/causes.a1.mjs and gd/diff.a1.mjs of this directory; probes/metadata.mjs beside it).
set -e
N=/workspace/notes/lint/units/parser
S=/tmp/gdr1a
mkdir -p $S/gd $S/runs $S/probes
cp -r $N/grammar-diff/. $S/gd/
cp $N/grammar-diff-oracle-and-causes/for-grammar-diff/oracle.mjs $N/grammar-diff-oracle-and-causes/for-grammar-diff/causes.mjs \
   $N/grammar-diff-oracle-and-causes/for-grammar-diff/diff.mjs $N/grammar-diff-oracle-and-causes/for-grammar-diff/harvest.mjs $S/gd/
cp $N/grammar-diff-oracle-and-causes/for-grammar-diff/targeted/09-checker-grammar.txt $S/gd/targeted/
cp $N/round2/grammar-diff-run/bottom-up/gd/causes.a1.mjs $N/round2/grammar-diff-run/bottom-up/gd/diff.a1.mjs $S/gd/
[ -f $N/round2/grammar-diff-run/bottom-up/gd/10-keeps-rejecting.txt ] && cp $N/round2/grammar-diff-run/bottom-up/gd/10-keeps-rejecting.txt $S/gd/targeted/
cp $N/probes/metadata.mjs $S/probes/
(cd $S/gd && bun gen.mjs targeted)
cp $N/round2/grammar-diff-run/bottom-up/run-all.sh $S/run-all.sh
# One lock for the oracle (78 s), the four harness runs (2 s, 2 s, 78 s, 79 s) and the two diffs:
#   HEAD_BIN=<bun of the head under test> HEAD_TAG=<tag> /workspace/tools/lk sh /tmp/gdr1a/run-all.sh
# then the table with the entries of this run:
#   cd /tmp/gdr1a/gd && for c in small targeted; do bun diff.a1.mjs ../runs/base.$c.jsonl.gz ../runs/<tag>.$c.jsonl.gz \
#     --oracle=../runs/oracle.$c.jsonl.gz --causes=causes.a1.mjs --out=../runs/diff.a1.<tag>.$c.jsonl --show=1 > ../runs/diff.a1.<tag>.$c.txt; done
# Required: the last line says "0 records with the mark !!", no row has the class A>R, crash, hang or missing.
echo "scratch ready in $S"
