#!/bin/sh
# The proof of cost of round 3, from three binaries:
#   BASE  main                                                  /workspace/base/bun-profile.bc7a813b1 (= bun-profile.f4d755a9c)
#   REF   the reference text of a parse without lint, linked in the crates of the head build ($S/link/ref/bun-profile)
#   HEAD  the release build of the branch                       /workspace/bun/build/release/bun-profile
# REF - BASE is what is not the work of this round (the boxed tables, the sink form, Metadata::MDot in the arena, the other
# crates of the branch). HEAD - REF is this round: required are the same machine code for everything that is not
# P<true, false> or lint-only, +0 Ir and +0 Bc on the parser symbols of js-control, and for the four TypeScript groups
# Bc(HEAD) - Bc(REF) = executed tests of the side-table option, function by function.
# usage: /workspace/tools/lk report2.sh [<out dir>]
#   a step whose output exists is not run again (remove the file to repeat it); NOCG=1 runs no valgrind at all
# env: S (scratch, default /tmp/costproof)  BASE REF HEAD (binaries)  REFTREE HEADTREE (trees that hold src/js_parser)
#      BASEBUN HEADBUN (stripped binaries)  COUNT (dir with <group>.err of a counting build) SITES (its sites.tsv)  ALLOW (siteaudit)
#      NOLINT (bun-profile of the head tree with the predicate a constant false: it must be the reference, function by function)
#      EXCEPT (regex of the names that are accepted exceptions of tsdiff.py)
S=${S:-/tmp/costproof}
O=${1:-$S/report}
BASE=${BASE:-/workspace/base/bun-profile.bc7a813b1}; HEAD=${HEAD:-/workspace/bun/build/release/bun-profile}; REF=${REF:-$S/link/ref/bun-profile}
BASEBUN=${BASEBUN:-/workspace/base/bun.bc7a813b1}; HEADBUN=${HEADBUN:-$(dirname $HEAD)/bun}
REFTREE=${REFTREE:-$S/root/ref}; HEADTREE=${HEADTREE:-/workspace/wt/parser}
L=/workspace/notes/lint/tools
P=/workspace/notes/lint/units/parser/round3/proof-cost/tools
P2=${P2:-/workspace/notes/lint/units/parser/round3/proof-cost/bottom-up-1a}
M=/workspace/notes/lint/units/parser/measure
G="bun-types typescript-lib src-js tsx js-control"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
mkdir -p "$O"
for b in "$BASE" "$REF" "$HEAD"; do [ -x "$b" ] || { echo "no binary $b"; exit 1; }; done
bin() { case $1 in base) echo $BASE ;; ref) echo $REF ;; head) echo $HEAD ;; esac; }
# 1. sizes: parser text, the four P rows, the skipper, the stripped binaries (the strip command of build.ninja)
for t in base ref head; do
  python3 $L/symsizes.py $(bin $t) > $O/$t.sym.txt
  python3 $M/grammar-syms.py $(bin $t) > $O/$t.grammar-syms.txt 2>/dev/null
done
[ -f $O/ref.bun ] || /usr/bin/strip --strip-all --strip-debug --discard-all -R .eh_frame -R .eh_frame_hdr -R .gcc_except_table $REF -o $O/ref.bun
{ stat -L -c 'base %s %n' $BASEBUN; stat -L -c 'ref  %s %n' $O/ref.bun; [ -f "$HEADBUN" ] && stat -L -c 'head %s %n' $HEADBUN; } > $O/stripped.txt
# 2. machine code, function by function
python3 $P2/tsdiff.py $REF $HEAD --trees $REFTREE,$HEADTREE ${EXCEPT:+--except "$EXCEPT"} > $O/tsdiff.ref-head.txt; echo "tsdiff exit $?" >> $O/tsdiff.ref-head.txt
python3 $P/fncmp.py $BASE $REF --inst . --all > $O/fncmp.all.base-ref.txt
python3 $P/fncmp.py $REF $HEAD --inst 'skip_type_?script|skip_typescript' --all > $O/fncmp.skipper.ref-head.txt
python3 $P/fncmp.py $BASE $REF --inst 'skip_type_?script|skip_typescript' --all > $O/fncmp.skipper.base-ref.txt
python3 $P/fnclass.py $BASE $REF --inst . > $O/fnclass.all.base-ref.txt
python3 $P/lintcalls.py $HEAD --inst 'P<false, ?(false|true)>|P<true, ?true>' > $O/lintcalls.shared.head.txt
python3 $P/optsites.py $REF > $O/optsites.js.ref.txt; python3 $P/optsites.py $HEAD > $O/optsites.js.head.txt
if [ -n "$NOLINT" ]; then python3 $P2/tsdiff.py $REF $NOLINT --trees $REFTREE,$HEADTREE ${EXCEPT:+--except "$EXCEPT"} > $O/tsdiff.ref-nolint.txt; echo "tsdiff exit $?" >> $O/tsdiff.ref-nolint.txt; fi
# 3. counts in both VEX modes, transpiler cache of the run time off
if [ -z "$NOCG" ]; then
  for t in base ref head; do
    [ -f $O/raw$t.js-control.cg ] || $P/cgbench-raw.sh $(bin $t) $O raw$t 20 > $O/raw$t.jsonl
    [ -f $O/$t.js-control.cg ] || $L/cgbench.sh $(bin $t) $O $t 20 > $O/$t.jsonl
  done
  [ -n "$NOLINT" ] && { [ -f $O/rawnolint.js-control.cg ] || $P/cgbench-raw.sh $NOLINT $O rawnolint 20 > $O/rawnolint.jsonl; }
fi
for g in $G; do for t in base ref head; do [ -f $O/raw$t.$g.log ] && grep -A1 '^group' $O/raw$t.$g.log | tail -1 | cut -c1-72; done; done | uniq -c > $O/work.txt
# 4. the tables
python3 $P/r3table.py $O base ref --raw > $O/table.base-ref.txt
python3 $P/r3table.py $O ref head --raw ${NOLINT:+--nolint nolint} > $O/table.ref-head.txt
python3 $P/r3table.py $O base head --raw > $O/table.base-head.txt
for g in $G; do
  python3 $M/tools/cgdiff.py $O/rawref.$g.cg $O/rawhead.$g.cg --match bun_js_parser --top 80 > $O/cgdiff.raw.$g.ref-head.txt
  python3 $M/tools/cgdiff.py $O/rawbase.$g.cg $O/rawref.$g.cg --match bun_js_parser --top 80 > $O/cgdiff.raw.$g.base-ref.txt
  [ -f $O/ref.$g.cg ] && [ -f $O/head.$g.cg ] && python3 $M/tools/cgdiff.py $O/ref.$g.cg $O/head.$g.cg --match bun_js_parser --top 80 > $O/cgdiff.default.$g.ref-head.txt
done
# 5. the added branches are the executed tests, function by function and site by site
python3 $P2/testeq.py $O ref head --src $HEADTREE ${COUNT:+--count $COUNT} --all > $O/testeq.ref-head.txt; echo "testeq exit $?" >> $O/testeq.ref-head.txt
[ -n "$COUNT" ] && [ -n "$SITES" ] && python3 $P/sitetable.py $SITES $COUNT > $O/sites.txt
# 6. the text: shared files against the reference
python3 $P/siteaudit.py --ref $REFTREE --head $HEADTREE --sites ${ALLOW:+--allow $ALLOW} > $O/siteaudit.txt
# what to read
paste $O/base.sym.txt $O/ref.sym.txt $O/head.sym.txt | head -8; cat $O/stripped.txt
grep -E '^(SHARED|MOVED|OTHER|GONE)' $O/tsdiff.ref-head.txt | head; tail -3 $O/tsdiff.ref-head.txt
[ -f $O/tsdiff.ref-nolint.txt ] && { echo 'nolint against ref:'; grep -vE '^offset' $O/tsdiff.ref-nolint.txt | head; }
printf 'skipper ref-head   %s | %s\n' "$(head -1 $O/fncmp.skipper.ref-head.txt)" "$(tail -1 $O/fncmp.skipper.ref-head.txt)"
printf 'all     base-ref   %s\n' "$(head -1 $O/fncmp.all.base-ref.txt)"
tail -1 $O/lintcalls.shared.head.txt; tail -1 $O/optsites.js.ref.txt; tail -1 $O/optsites.js.head.txt
cat $O/table.ref-head.txt; cat $O/table.base-ref.txt
grep -E '^(bun-types|typescript-lib|src-js|tsx|js-control) |<-- |^PASS|^FAIL|testeq exit' $O/testeq.ref-head.txt
[ -f $O/sites.txt ] && tail -5 $O/sites.txt
tail -2 $O/siteaudit.txt; cat $O/work.txt
