#!/bin/sh
# The proof of cost of round 3 (R3 of goals/parser3.md), from three binaries and two trees:
#   BASE  main                                              /workspace/base/bun-profile.f4d755a9c (a link to bun-profile.bc7a813b1)
#   REF   the reference text of ../tools/mkref.sh, linked by r3cycle.sh as tag `ref`: main's parser text + the sink form +
#         the boxed tables + Metadata::MDot in the arena, in the crates of HEAD          $S/link/ref/bun-profile
#   HEAD  the release build of the branch                   /workspace/bun/build/release/bun-profile
# REF - BASE is what a parse pays or saves for reasons that are not the work of this round (the boxed tables, MDot, the
# other crates of the branch): every function of it is named. HEAD - REF is the work of this round. Required:
#   1. every symbol that JavaScript and a scan-only parse run has the machine code of REF (fncmp2.py --strict: PASS)
#   2. js-control: +0 Ir, +0 Bc, +0 Bi on the parser, both VEX modes
#   3. the four TypeScript groups: (Bc head - ref) = executed tests of the side table, function by function
#   4. the skipper, both sinks, has the machine code of REF
#   5. the shared files are the reference text plus sites (siteaudit2.py: PASS), src/ast/ts.rs is main's plus MDot
# usage: /workspace/tools/lk r3report.sh [<out dir>]      a step whose output exists is not run again: remove the file to repeat it
# Environment (defaults in brackets): S [/tmp/costproof]  BASE  BASE_BUN  REF  HEAD  HEAD_BUN  REF_TREE [$S/root/ref]
#   HEAD_TREE [/workspace/wt/parser]  AST_BASE [bc7a813b10]  ELSE=1 (accept sites with an else arm)  ALLOW=<file of exceptions>
#   COUNT=<bun-profile of a counting build> SITES=<its sites.tsv> (../tools/sitecount.py)  LINTONLY  SITE (see cgclass.py)
S=${S:-/tmp/costproof}
O=${1:-$S/report}
BASE=${BASE:-/workspace/base/bun-profile.f4d755a9c}; BASE_BUN=${BASE_BUN:-/workspace/base/bun.f4d755a9c}
HEAD=${HEAD:-/workspace/bun/build/release/bun-profile}; HEAD_BUN=${HEAD_BUN:-$(dirname $HEAD)/bun}
REF=${REF:-$S/link/ref/bun-profile}
REF_TREE=${REF_TREE:-$S/root/ref}; HEAD_TREE=${HEAD_TREE:-/workspace/wt/parser}; AST_BASE=${AST_BASE:-bc7a813b10}
LINTONLY=${LINTONLY:-'parse::(erased|wrappers|attached|generics|syntax_errors|lint[a-z_]*)::|ForLint|for_lint|type_sink::Build|::lint_[a-z_]+'}
L=/workspace/notes/lint/tools
P=/workspace/notes/lint/units/parser/round3/proof-cost/tools
M=/workspace/notes/lint/units/parser/measure
H=$(cd "$(dirname "$0")" && pwd)
G="bun-types typescript-lib src-js tsx js-control"
STRICT='^(?!.*(<true, ?false>|_parse::?<true>))'
SITE=${SITE:-'^\s*if (?:p|self)\.lint\(\)'}
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
mkdir -p "$O"
for b in "$BASE" "$REF" "$HEAD"; do [ -x "$b" ] || { echo "no binary $b"; exit 1; }; done
bin() { case $1 in base) echo $BASE ;; ref) echo $REF ;; head) echo $HEAD ;; esac; }
# 1. sizes: parser text, the four P rows, the skipper by sink, the stripped binaries
for t in base ref head; do
  python3 $L/symsizes.py $(bin $t) > $O/$t.sym.txt
  python3 $M/grammar-syms.py $(bin $t) > $O/$t.grammar-syms.txt 2>/dev/null
  python3 $H/symsizes2.py $(bin $t) --lint "$LINTONLY" > $O/$t.sym2.txt
done
STRIP='/usr/bin/strip --strip-all --strip-debug --discard-all -R .eh_frame -R .eh_frame_hdr -R .gcc_except_table'
$STRIP $REF -o $O/ref.stripped; [ -f "$HEAD_BUN" ] || { $STRIP $HEAD -o $O/head.stripped; HEAD_BUN=$O/head.stripped; }
stat -c '%s %n' "$BASE_BUN" $O/ref.stripped "$HEAD_BUN" > $O/stripped.txt; rm -f $O/ref.stripped
# 2. machine code, function by function. ref against head is the acceptance; base against ref names the exceptions.
python3 $H/fncmp2.py $REF $HEAD --strict --allow-only-b "$LINTONLY" --all > $O/fncmp.strict.ref-head.txt
python3 $H/fncmp2.py $REF $HEAD --inst 'skip_type_?script|skip_typescript' --all > $O/fncmp.skipper.ref-head.txt
python3 $H/fncmp2.py $REF $HEAD --ts --allow-only-b "$LINTONLY" --all > $O/fncmp.ts.ref-head.txt
python3 $H/fncmp2.py $BASE $REF --strict --all > $O/fncmp.strict.base-ref.txt
python3 $H/fncmp2.py $BASE $REF --ts --all > $O/fncmp.ts.base-ref.txt
python3 $P/fnclass.py $BASE $REF --inst . > $O/fnclass.base-ref.txt
for t in base ref head; do python3 $P/optsites.py $(bin $t) --inst "$STRICT" > $O/optsites.strict.$t.txt; done
python3 $P/lintcalls.py $HEAD --inst "$STRICT" --callee "$LINTONLY" > $O/lintcalls.strict.head.txt
# 3. counts in both VEX modes, transpiler cache of the run time off
for t in base ref head; do
  [ -f $O/$t.js-control.cg ] || $L/cgbench.sh $(bin $t) $O $t 20 > $O/$t.jsonl
  [ -f $O/raw$t.js-control.cg ] || $P/cgbench-raw.sh $(bin $t) $O raw$t 20 > $O/raw$t.jsonl
done
# the same work on every side: files, bytes, passes and output length of each group
for g in $G; do for t in base ref head; do grep -A1 '^group' $O/raw$t.$g.log | tail -1 | cut -c1-72; done; done | uniq -c > $O/work.txt
# 4. the tables, by function body
python3 $H/r3table2.py $O ref $REF head $HEAD --src "$HEAD_TREE" --site "$SITE" > $O/table.ref-head.txt
python3 $H/r3table2.py $O base $BASE ref $REF > $O/table.base-ref.txt
python3 $H/r3table2.py $O ref $REF head $HEAD --match 'bun_js_parser|bun_ast|bun_js_printer|bun_sourcemap' --no-default > $O/table.wide.ref-head.txt
python3 $H/r3table2.py $O base $BASE ref $REF --match 'bun_js_parser|bun_ast|bun_js_printer|bun_sourcemap' --no-default > $O/table.wide.base-ref.txt
python3 $H/r3table2.py $O base $BASE head $HEAD --src "$HEAD_TREE" --site "$SITE" > $O/table.base-head.txt
python3 $H/vexonly.py $O ref $REF head $HEAD > $O/vexonly.ref-head.txt
for g in $G; do
  python3 $H/cgclass.py $REF $O/rawref.$g.cg $HEAD $O/rawhead.$g.cg --src "$HEAD_TREE" --site "$SITE" --top 200 > $O/cgclass.raw.$g.ref-head.txt
  python3 $H/cgclass.py $BASE $O/rawbase.$g.cg $REF $O/rawref.$g.cg --top 200 > $O/cgclass.raw.$g.base-ref.txt
  # the executed tests by site, and every line of the parser whose counts differ
  python3 $P/cgsites.py $O/rawhead.$g.cg --src "$HEAD_TREE" --pat "$SITE" > $O/sites.cg.$g.txt
  python3 $P/cglinediff.py $O/rawref.$g.cg $O/rawhead.$g.cg --fn 'bun_js_parser' --srca "$REF_TREE" --srcb "$HEAD_TREE" --by ir --top 80 > $O/cglinediff.ir.$g.ref-head.txt
  python3 $P/cglinediff.py $O/rawref.$g.cg $O/rawhead.$g.cg --fn 'bun_js_parser' --srca "$REF_TREE" --srcb "$HEAD_TREE" --by bc --top 80 > $O/cglinediff.bc.$g.ref-head.txt
done
# 5. the same counts from a counting build, run without valgrind (cross-check of the lines of step 4)
if [ -n "$COUNT" ] && [ ! -f $O/sites.count.txt ]; then
  mkdir -p $O/count
  for g in $G; do
    BUN_LINT_TEST_COUNT=1 BUN_DEBUG_QUIET_LOGS=1 $COUNT /workspace/notes/lint/benchroot/bench/snippets/transpiler-typescript.mjs --iterations=1 --group=$g > $O/count/$g.out 2> $O/count/$g.err
  done
  python3 $P/sitetable.py "$SITES" $O/count > $O/sites.count.txt
fi
# 6. the text: shared files against the reference, src/ast/ts.rs against main
python3 $H/siteaudit2.py --ref "$REF_TREE" --head "$HEAD_TREE" --sites ${ELSE:+--else} ${ALLOW:+--allow $ALLOW} --ast-base $AST_BASE --repo /workspace/bun > $O/siteaudit.txt
# what to read
echo "== sizes by address (symbols, bytes): base | ref | head; then the stripped binaries"
paste -d'|' $O/base.sym2.txt $O/ref.sym2.txt $O/head.sym2.txt | awk -F'|' '{printf "%s |%s |%s\n", $1, substr($2, 35), substr($3, 35)}'
cat $O/stripped.txt
echo "== machine code"
printf 'strict  ref-head  %s | %s\n' "$(head -1 $O/fncmp.strict.ref-head.txt)" "$(tail -1 $O/fncmp.strict.ref-head.txt)"
printf 'skipper ref-head  %s | %s\n' "$(head -1 $O/fncmp.skipper.ref-head.txt)" "$(tail -1 $O/fncmp.skipper.ref-head.txt)"
printf 'ts      ref-head  %s\n' "$(head -1 $O/fncmp.ts.ref-head.txt)"
printf 'strict  base-ref  %s\n' "$(head -1 $O/fncmp.strict.base-ref.txt)"
printf 'ts      base-ref  %s\n' "$(head -1 $O/fncmp.ts.base-ref.txt)"
for t in base ref head; do printf 'strict  %-4s %s\n' $t "$(tail -1 $O/optsites.strict.$t.txt)"; done
tail -1 $O/lintcalls.strict.head.txt
echo "== counts"
cat $O/table.ref-head.txt; cat $O/table.base-ref.txt; cat $O/table.wide.ref-head.txt
for g in $G; do printf '%-15s %s\n' $g "$(tail -1 $O/cgclass.raw.$g.ref-head.txt)"; done
cat $O/vexonly.ref-head.txt
[ -f $O/sites.count.txt ] && tail -5 $O/sites.count.txt
echo "== text"; tail -2 $O/siteaudit.txt
echo "== work"; cat $O/work.txt
