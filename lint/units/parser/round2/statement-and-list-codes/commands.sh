#!/bin/sh
# Reproduces the oracle files of this directory. Nothing here touches a worktree.
# 1. The parser of typescript-go 89d5d5b as a command (about ten minutes the first time: it builds Go 1.26 from source):
#      /workspace/tools/lk bash /workspace/notes/lint/units/parser/ledger/bottom-up/tsgo-oracle/build.sh /tmp/rr /tmp/rr/parsediag-bu
# 2. The inputs and, for each, tsc 6.0.2, typescript-go and the bun that runs the script (scanImports: the parse pass alone;
#    transformSync: parse and visit). out1.txt ... out6.txt were made with build/release/bun of be1ebe5295 (no lint parse).
cd "$(dirname "$0")" || exit 1
BUN=${BUN:-/workspace/wt/parser/build/release/bun}
for n in 1 2 3 4 5 6; do
  node make-inputs$n.cjs
  "$BUN" probe.cjs inputs$n.json --go /tmp/rr/parsediag-bu > out$n.txt
  node firstdiff.cjs out$n.txt | tail -1
done
# 3. One line for each input: ./condense.sh out4.txt
# 4. The transliteration of parseErrorForMissingSemicolonAfter against the oracle: 338 names, 0 differ.
node check-port.cjs out4.txt out1.txt out2.txt out3.txt
# 5. The rows of the Rust tests, with the values of typescript-go: test-rows.txt
node make-test-rows.cjs > test-rows.txt
