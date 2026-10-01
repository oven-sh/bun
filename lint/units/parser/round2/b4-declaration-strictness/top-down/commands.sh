#!/bin/sh
# Reproduces the files of this directory. Nothing here writes in a worktree.
# Needs: typescript-go 89d5d5b as a command (/tmp/rr/parsediag-bu: ../../../ledger/bottom-up/tsgo-oracle/build.sh),
# the probe binary of the head's lint parse (/tmp/smph/out/bun_js_parser: ../../strict-members-params-heritage/bottom-up/build-probe.sh),
# tsc 6.0.2 (node_modules/typescript of the worktree) and the release build of the worktree (be1ebe5295).
cd "$(dirname "$0")" || exit 1
BUN=${BUN:-/workspace/wt/parser/build/release/bun}
for n in 1 2 3 4; do
  node make-inputs$n.cjs > inputs$n.json
  "$BUN" probe.cjs inputs$n.json > out$n.txt      # class, typescript-go, tsc (parser, else checker), the lint parse, the parse without lint
  node rows.cjs inputs$n.json > rows$n.txt        # the rows of the Rust tables, from typescript-go
done
# The inputs of the earlier research with typescript-go as the reference (no input differs between its parser and tsc's):
P=../../strict-members-params-heritage/top-down
for n in "" 2 3; do "$BUN" probe.cjs $P/inputs$n.json > prior${n:-1}.go.txt; done
