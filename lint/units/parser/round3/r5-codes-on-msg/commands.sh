#!/bin/sh
# How the results of this directory were made (research for R5, B2: the tsc code on the Msg). Nothing is written in the worktree.
# Tree: /workspace/wt/parser at 23a20afa7e with its finished release build (build/release). Base: /workspace/base/bun.f4d755a9c.
# Scratch: /tmp/r5codes (root/<variant>/src/js_parser = patched copy, out/<variant> = assembly and rlib, link/<variant> = linked object).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
SEAM=/workspace/notes/lint/units/parser/paren-expr-seam
S=/tmp/r5codes
mkdir -p $S/link $S/thinlto-cache
cp "$HERE"/variants.py "$HERE"/fncmp.py "$HERE"/harvest.sh "$HERE"/probe-window.mjs "$HERE"/oracle.cjs "$HERE"/oracle2.cjs $S/
cd $S

# 1. The variants of the two calls in shared code that only a syntax error reaches:
#    head  = the tree as it is: parse_prefix ends in p.unexpected_as(EXPRESSION_EXPECTED)?, parse_stmt_fallthrough has a match with an Err arm
#    la0   = the last arm of parse_prefix as on main: p.lexer.unexpected()?
#    la1   = the last arm calls a cold method without an argument: p.expression_expected()?
#    st0   = parse_stmt_fallthrough as on main: let expr_or_let = p.parse_expr_or_let_stmt(opts)?;
#    st1   = the same line with .map_err(|err| p.statement_expected_at(loc, opts, err))?
python3 variants.py head la0 la1 st0 st1 both0

# 2. Assembly of the crate alone, with the rustc command of the release build (about 25 s each): the code before the ThinLTO link.
for v in head la0 la1 st0 st1; do EMIT=asm RELAX=1 OUT=$S/out /workspace/tools/lk python3 $SEAM/run.py $v $S/root/$v; done
A=bun_js_parser-185fe25973f3a1f8.s
python3 fncmp.py out/la0/asm/$A out/head/asm/$A --show "P<false, false>>::parse_prefix" > "$HERE"/results/prelink.la0-head.txt
python3 fncmp.py out/la0/asm/$A out/la1/asm/$A --show "P<false, false>>::parse_prefix" > "$HERE"/results/prelink.la0-la1.txt
python3 fncmp.py out/st0/asm/$A out/head/asm/$A > "$HERE"/results/prelink.st0-head.txt
python3 fncmp.py out/st0/asm/$A out/st1/asm/$A > "$HERE"/results/prelink.st0-st1.txt

# 3. The code that ships: one rlib per variant, then the native object of the bun_js_parser module as the ThinLTO link compiles it
#    (74 s with an empty cache, about 40 s after that). The unpatched copy gives the bitcode of the release build, byte for byte.
for v in head la0 la1 st0 st1; do RELAX=1 OUT=$S/out /workspace/tools/lk python3 $SEAM/run.py $v $S/root/$v; done
/workspace/tools/lk $S/harvest.sh la0 head la1 st0 st1
export PATH=/usr/lib/llvm-23/bin:$PATH
python3 $SEAM/objfn.py link/la0/bun_js_parser.lto.o link/head/bun_js_parser.lto.o --cmp --match 'P<false, false>>::parse_prefix$' --diff 40 --all > "$HERE"/results/postlink.la0-head.txt 2>&1
python3 $SEAM/objfn.py link/la0/bun_js_parser.lto.o link/la1/bun_js_parser.lto.o --cmp --match 'P<false, false>>::parse_prefix$' --diff 40 --all > "$HERE"/results/postlink.la0-la1.txt 2>&1
python3 $SEAM/objfn.py link/st0/bun_js_parser.lto.o link/head/bun_js_parser.lto.o --cmp --match '.' --all > "$HERE"/results/postlink.st0-head.txt 2>&1
python3 $SEAM/objfn.py link/st0/bun_js_parser.lto.o link/st1/bun_js_parser.lto.o --cmp --match '.' --all > "$HERE"/results/postlink.st0-st1.txt 2>&1

# 4. Whether a statement of a list starts at the token that failed, asked of the parser itself: the text before the token is parsed
#    again with `const _=0;if(0);` after it. 34 sources, with main's parse pass (scanImports of the base binary).
/workspace/base/bun.f4d755a9c probe-window.mjs > "$HERE"/results/probe-window.base-f4d755a9c.txt

# 5. The first parse diagnostic of tsc 6.0.2 for the sources of the tests and of the probe.
node oracle.cjs > "$HERE"/results/oracle.tsc602.txt
node oracle2.cjs > "$HERE"/results/oracle2.tsc602.txt

# 6. The messages of a parse without lint, base and head: the same 29 lines (the last line is the revision).
N=/workspace/notes/lint/units/parser/round2/b2-codes-on-msg/probe/nolint.mjs
/workspace/base/bun.f4d755a9c $N > "$HERE"/results/nolint.base-f4d755a9c.txt
/workspace/wt/parser/build/release/bun $N > "$HERE"/results/nolint.head-23a20afa7e.txt
