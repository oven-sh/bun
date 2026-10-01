#!/bin/sh
# Probes of the research on B3 (round 2, top-down): what the reference reports for an operand that Bun's parse pass
# takes, and the rows of the Rust tables. Run from this directory. Nothing here writes in a worktree.
# The parser of typescript-go 89d5d5b as a command: ../../../ledger/bottom-up/tsgo-oracle/build.sh /tmp/rr /tmp/rr/parsediag-bu
# BUN is a build whose parse pass is under test: the release build of be1ebe5295 was /workspace/notes/lint/measure/parser/head/bun.
BUN=${BUN:-/workspace/notes/lint/measure/parser/head/bun}
GO=${GO:-/tmp/rr/parsediag-bu}
# 1. The first two diagnostics of typescript-go, whether tsc 6.0.2 agrees on the first, and what the parse pass and the visit pass of BUN do.
$BUN probe.cjs in-core.json --go $GO > out-core.txt
node make-contexts.cjs && $BUN probe.cjs in-contexts.json --go $GO > out-contexts.txt
$BUN probe.cjs in-asi.json --go $GO > out-asi.txt
$BUN probe.cjs in-rest.json --go $GO > out-rest.txt
$BUN probe.cjs in-left.json --go $GO > out-left.txt
$BUN probe.cjs in-misc.json --go $GO > out-misc.txt
# 2. The rows of the tables: (text, loader, code, start, end, message) of the first diagnostic of typescript-go, each checked against tsc 6.0.2.
node make-test-rows.cjs $GO > test-rows.txt
# 3. Which rows the parse pass of BUN rejects on its own (be1ebe5295: 7 of 351 with a diagnostic, 0 of 132 without).
$BUN bun-accepts.mjs > bun-accepts.head-be1ebe5295.txt
# 4. The token scan of the plan, modelled with the scanner of tsc over the rows (119 and 130 rows, no mismatch).
node scan-model.cjs > scan-model.txt; node scan-model-assign.cjs >> scan-model.txt
# 5. How often each site runs in the five groups of cgbench (per parse): the nodes of tsc's tree over the fixed inputs.
(cd ../../expression-operand-rejections/top-down && node count-sites.cjs) > count-sites.benchroot.jsonl
