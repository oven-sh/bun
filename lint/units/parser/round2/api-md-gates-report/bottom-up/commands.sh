#!/bin/sh
# Research for "API.md, the closing gates and the final report" of the parser unit, round 2 (B5 and the proofs that close the round).
# Tree: /workspace/wt/parser at be1ebe5295. Nothing here writes in the worktree. Not saved with save-notes (the phase had no git).
#
# Files of this directory
#   gates.sh          one closing gate per call, in the order of the final report; logs and one summary line per gate under $OUT
#   api_surface.py    the public names of the interface files that API.md does not hold (116 at be1ebe5295, 5 once the blocks of ../../api-sidecar-contract are pasted)
#   copy_audit.py     the node and record types that are not Copy (9 of 114 at be1ebe5295: five tables, ListFrame, AsyncTypeLists, SyntaxError, Recorded)
#   panic_audit.py    the lines added outside tests that can panic (0 at be1ebe5295)
#   lint-parse-command.test.ts.draft   the test through `bun --lint`, for the day the command calls the lint parse; its expectations are predictions
set -e
H=/workspace/notes/lint/units/parser/round2/api-md-gates-report/bottom-up
W=/workspace/wt/parser
# What ran for this research (the heavy one through the lock):
python3 /workspace/notes/lint/tools/commentcop.py e3566be889...HEAD --all        # in $W: added multi-line comment runs: 0 in 0 files
python3 $H/api_surface.py $W /workspace/notes/lint/units/parser/API.md | tail -1   # 116 public names that API.md does not hold
python3 $H/copy_audit.py $W                                                       # 114 types outside test modules, 9 not Copy
python3 $H/panic_audit.py $W                                                      # 0 added lines outside tests that can panic
(cd $W && /workspace/tools/lk bun test test/internal/source-lints/)               # 170 pass, 0 fail, 32 files, 14 s (the lock was 37 min away)
(cd $W && bun --bun ./node_modules/.bin/prettier --plugin=prettier-plugin-organize-imports --config .prettierrc --check test/bundler/transpiler/typescript-grammar*.test.ts)
# The closing gates on the final HEAD. Three chains, each one call of the lock, started in the background and read from $OUT/summary.txt:
#   nohup setsid /workspace/tools/lk bash -c "for s in check clippy fmt cargotest miri source-lints; do bash $H/gates.sh \$s; done" > /tmp/gates-1.log 2>&1 &
#   nohup setsid /workspace/tools/lk bash -c "for s in tests-plain tests-leak; do bash $H/gates.sh \$s; done" > /tmp/gates-2.log 2>&1 &
#   nohup setsid /workspace/tools/lk bash -c "for s in release a1 cg symsizes sizes; do bash $H/gates.sh \$s; done" > /tmp/gates-3.log 2>&1 &
#   bash $H/gates.sh commentcop; bash $H/gates.sh audit; bash $H/gates.sh surface; python3 $H/panic_audit.py $W
