#!/bin/sh
# A3, research: the switch in a scratch copy of src/js_parser, one relinked release binary and one relinked debug binary,
# the sweeps, the grammar-diff corpora through both modes, the draft of the test. Nothing is written into /workspace/wt/parser.
# Needs: a finished `bun run build:release` and a finished `bun bd` in /workspace/wt/parser (build/release, build/debug).
set -e
H=/workspace/notes/lint/units/parser/round2/a3/bottom-up
P=/workspace/notes/lint/units/parser/paren-expr-seam
S=/tmp/a3-seam
mkdir -p $S/root/exp/src $S/root/final/src $S/root/base/src $S/sweep $S/gd $S/dbg $S/t/dry
for v in exp final base; do rm -rf $S/root/$v/src/js_parser; cp -r /workspace/wt/parser/src/js_parser $S/root/$v/src/js_parser; done
# exp: the switch compiled in every build, with the research values `ambient` (top level ambient) and `keep` (the side table lives through the visit pass);
#      and the check of the scope offset in push_scope_for_visit_pass made unconditional (p.rs).
python3 $H/patch_exp.py $S/root/exp
# final: the seven lines under #[cfg(debug_assertions)] that the plan proposes
python3 $H/patch_final.py $S/root/final
# 1. release: the assembly of the crate with and without the proposed lines is the same file (563,252 lines, diff empty)
OUT=$S/asm EMIT=asm python3 $P/run.py base $S/root/base; OUT=$S/asm EMIT=asm python3 $P/run.py final $S/root/final
diff $S/asm/base/asm/*.s $S/asm/final/asm/*.s && echo "release assembly identical"
# 2. the proposed lines under the flags and lints of the debug build (7 s), and rustfmt
OUT=$S/out-debug-meta EMIT=metadata python3 $H/run_debug.py final $S/root/final
rustfmt --edition 2024 --check $S/root/final/src/js_parser/parse/parse_entry.rs
# 3. release binary with the switch (rlib 45 s, link 14 min under the lock with a cold ThinLTO cache)
OUT=$S/out RELAX=1 python3 $P/run.py exp $S/root/exp
OUT=$S/link CACHE=$S/thinlto-cache /workspace/tools/lk python3 $P/relink.py exp $S/out/exp/libbun_js_parser-185fe25973f3a1f8.rlib full
# 4. debug binary with the switch (rlib 77 s, link 68 s under the lock)
OUT=$S/out-debug RELAX=1 python3 $H/run_debug.py exp $S/root/exp
/workspace/tools/lk python3 $H/relink_debug.py exp $S/out-debug/exp/libbun_js_parser-8337f9633b1f3cf3.rlib
# 5. the sweep: see sweep/ (worker.js <list.json> <out.jsonl>, compare.mjs <normal.jsonl> <lint.jsonl>); lists are made from glob-files.txt (count.mjs)
#    env -i PATH=$PATH HOME=$HOME BUN_DEBUG_QUIET_LOGS=1 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 [BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT=1] <binary> worker.js all.list.json <out>
# 6. the grammar-diff corpora through both modes of the release binary, and the classes against the oracle of tsc
/workspace/tools/lk sh $H/gd/run.sh
(cd $S/gd && bun $H/gd/analyze.mjs diff.small.jsonl analysis.small.json && bun $H/gd/aa-check.cjs && bun $H/gd/ra.mjs)
# 7. the debug sweep, the leak check of CI, and the draft of the test on the debug binary (dry copy: root from A3_ROOT, harness by tsconfig paths)
/workspace/tools/lk sh $H/dbg/run.sh
# 8. the proposed lines as they are (patch_final3.py = parse_entry.final3.diff): release assembly identical, debug flags clean,
#    then a relinked debug binary runs the draft of the test, plain and with the leak check of CI
python3 $H/patch_final3.py $S/root/final3   # after: cp -r /workspace/wt/parser/src/js_parser $S/root/final3/src/js_parser
OUT=$S/asm EMIT=asm python3 $P/run.py final3 $S/root/final3 && diff $S/asm/base/asm/*.s $S/asm/final3/asm/*.s
OUT=$S/out-debug python3 $H/run_debug.py final3 $S/root/final3
/workspace/tools/lk sh $H/dbg/run-final3.sh
# 9. the draft on the debug build of the worktree without the switch: it must fail at the sentinel
/workspace/tools/lk sh $H/dbg/run-no-switch.sh
# 10. existing test files with every parse of the process as the lint parse pass, against the same binary without it
/workspace/tools/lk sh $H/suite/run.sh
