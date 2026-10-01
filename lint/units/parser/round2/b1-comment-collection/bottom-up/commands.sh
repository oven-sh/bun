#!/bin/sh
# Probes of the research on the comment list (round 2, B1, bottom-up). Run from this directory.
# tsc 6.0.2 comments of each input, read as the trivia before every token: must print table.expected.txt / bt.expected.txt / parity-case.expected.txt.
node trivia-oracle.cjs table.json
node trivia-oracle.cjs bt.json
node trivia-oracle.cjs parity-case.json
# tsc 6.0.2 node positions and parse diagnostics of the cases for the six test modules: cases2.nodes.expected.txt, diag1.expected.txt, diag2.expected.txt.
node ../../comments-capture/nodes.cjs cases2.json
node diag.cjs diag1.json
node diag.cjs diag2.json
# Which inputs a parse without lint takes:  <bun> accept.mjs table.json   (head be1ebe5295: all but type-arguments-empty)
# tsc side of the comparison over test/ and src/js (70 s, one process): node corpus-tsc.cjs /workspace/wt/parser out.tsv
#   at be1ebe5295: {"files":10768,"comments":135065,"withParseDiagnostics":78,"thrown":1}
# Which comments a minified parse WITHOUT lint lists (must not change): <bun release build> parity.mjs  -> parity.head-be1ebe5295.txt
# Comments that next_inside_jsx_element reads in a file: node jsxtag-exact.cjs bench/snippets/transpiler-typescript-fixture.tsx  -> 8 (lines 140,142,153,162,164,180,185,214)
#   over test/ and src/js: node jsxtag-corpus.cjs -> 745 files with JSX, 4337 tags, 0 comments inside a tag
# Layout model of LexerSnapshot with the flag as bool and as a one-byte enum: rustc --edition 2021 -O snap.rs && ./snap  -> 240 240, Comment 12
