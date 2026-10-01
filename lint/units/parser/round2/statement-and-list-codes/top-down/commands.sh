#!/bin/sh
# Reproduces the files of this directory. Nothing here writes in a worktree.
# 1. The parser of typescript-go 89d5d5b as a command: ../../../ledger/bottom-up/tsgo-oracle/build.sh /tmp/rr /tmp/rr/parsediag-bu
# 2. tsc 6.0.2, typescript-go and the debug build of the worktree (be1ebe5295) for the inputs of ../inputs1.json and of inputs2.json:
#      cd /workspace/wt/parser && /workspace/tools/lk bun bd <dir>/../probe.cjs <dir>/../inputs1.json --go /tmp/rr/parsediag-bu > out1.tsc-go-head.txt
#      node make-inputs2.cjs
#      cd /workspace/wt/parser && /workspace/tools/lk bun bd <dir>/../probe.cjs <dir>/inputs2.json --go /tmp/rr/parsediag-bu > out2.tsc-go-head.txt
# 3. One line for each input: node condense.cjs out1.tsc-go-head.txt '<regexp of a group>'
# 4. The rows of the Rust tests, the first diagnostic of typescript-go in bytes: node rows.cjs > rows.expected.txt
# 5. What the bun on PATH (1.4.3-canary.1+367d939d9, without the parser work) and the debug build do differently:
#      bun ../probe.cjs ../inputs1.json > /tmp/base1.txt && node bundiff.cjs /tmp/base1.txt out1.tsc-go-head.txt
