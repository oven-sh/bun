#!/bin/sh
# Codegen check of the expression sites of round 3. Nothing is written into /workspace/wt/parser.
# Needs: a finished `bun run build:release` of the worktree at 23a20afa7e (build/release/rust-target/units/bun_js_parser-*.json).
# Every variant is a patched copy of src/js_parser; variants/<tag>.diff is `diff -ru` of the copy against the worktree.
#   k0   main's text at the expression sites, no hook at all (the lint functions are unreachable)
#   m1   main's text + the TypeScript-only hooks; async and arrow bodies without a lint path
#   f    m1 + `!SCAN_ONLY` in the suffix hooks (hooks INSIDE parse_standard_decorator)
#   a    m1 + the lint twin of parse_async_prefix_expr behind main's existing `Some(starts)` arm
#   b    a  + the end of parse_arrow_body diverted in main's existing arm (REJECTED: changes the path without lint)
#   c    a  + the lookbehind `lint_flags_of_arrow_body` in the twins (no function of main changes)
#   s    k0 + the gate at the caller of parse_standard_decorator + its lint twin
#   z    c + s + f's suffix hooks: the whole proposal
#   u    z with main's `p.lexer.unexpected()?` in the last arm of parse_prefix
#   j0/j1  m1 with parse_jsx as on main / with the token test at the site before the option test
#   g h q r n  other shapes of the `@(expr)` hook (see results/fn.decorator-hook-forms.txt)
set -e
T=/workspace/notes/lint/units/parser/paren-expr-seam
N=/workspace/notes/lint/units/parser/round3/seam-expressions/top-down
S=/tmp/seam
mkdir -p $S/root $S/out
for v in "$@"; do
  rm -rf $S/root/$v && mkdir -p $S/root/$v/src && cp -r /workspace/wt/parser/src/js_parser $S/root/$v/src/js_parser
  (cd $S/root/$v/src/js_parser && patch -s -p3 < $N/variants/$v.diff)
  OUT=$S/out RELAX=1 EMIT=asm /workspace/tools/lk python3 $T/run.py $v $S/root/$v
done
# compare two variants, function by function (assembly of the crate alone, before the ThinLTO link):
#   python3 $T/fnstat.py $S/out/k0/asm $S/out/z/asm --cmp --match 'P<(false|true), (false|true)>>::[a-z_0-9]+$' | grep -v '^SAME'
# the code that ships needs $T/relink.py (harvest) and $T/objfn.py --cmp on the real tree after the restructuring.
# behaviour without lint, base (main f4d755a9c) against head (23a20afa7): sh probe/cmp.sh probe/c1.json
