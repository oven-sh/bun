#!/bin/bash
# Step 1 of A1: the four harness runs (release base and release head), the harvest check, the two oracle files.
set -u
S=/tmp/gdr1b
G=$S/gd
O=$S/out
M=/workspace/notes/lint/measure/parser
BASE=$M/base/bun
HEAD=$M/head/bun
cd "$G" || exit 1
echo "start $(date -u +%H:%M:%S)"
sha256sum "$BASE" "$HEAD"
"$BASE" --revision; "$HEAD" --revision
echo "== harvest with the base binary $(date -u +%H:%M:%S)"
"$BASE" harvest.mjs > "$O/09.base.txt" 2> "$O/09.base.log"; echo "rc $?"; cat "$O/09.base.log"
cmp "$O/09.base.txt" targeted/09-checker-grammar.txt && echo "09 unchanged"
echo "== gen targeted $(date -u +%H:%M:%S)"
"$HEAD" gen.mjs targeted; echo "rc $?"
ls -la corpus.targeted.json
for corpus in small targeted testrows; do
  for side in base head; do
    bin=$BASE; [ $side = head ] && bin=$HEAD
    echo "== harness $side $corpus $(date -u +%H:%M:%S)"
    "$bin" harness.mjs corpus.$corpus.json "$O/$side.$corpus.jsonl.gz" --jobs=4; echo "rc $?"
  done
done
echo "== oracle testrows $(date -u +%H:%M:%S)"
"$HEAD" oracle.mjs corpus.testrows.json "$O/oracle.testrows.jsonl.gz"; echo "rc $?"
echo "== oracle targeted $(date -u +%H:%M:%S)"
"$HEAD" oracle.mjs corpus.targeted.json "$O/oracle.targeted.jsonl.gz"; echo "rc $?"
echo "== oracle small $(date -u +%H:%M:%S)"
"$HEAD" oracle.mjs corpus.small.json "$O/oracle.small.jsonl.gz"; echo "rc $?"
echo "end $(date -u +%H:%M:%S)"
