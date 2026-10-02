#!/bin/sh
# The proof of cost of round 3, from three binaries:
#   BASE  main at f4d755a9cf                                   /workspace/base/bun-profile.f4d755a9c
#   REF   the reference text of mkref.sh, linked by cycle.sh    $S/link/ref/bun-profile   (main's parser text in the crates of HEAD)
#   HEAD  the release build of the branch                       /workspace/bun/build/release/bun-profile
# REF - BASE is what the parse pays or saves for reasons that are not the grammar work (Metadata::MDot in the arena, the
# boxed tables, the sink form, the other crates of the branch). HEAD - REF is the work of this unit: required +0 instructions
# and +0 conditional branches for js-control, and only executed tests of the side table for the four TypeScript groups.
# usage: /workspace/tools/lk report.sh [<out dir>]         (about 12 minutes when nothing is there yet; a step whose output
#        exists is not run again: remove the file to repeat it)
S=${S:-/tmp/costproof}
O=${1:-$S/report}
BASE=${BASE:-/workspace/base/bun-profile.f4d755a9c}; HEAD=${HEAD:-/workspace/bun/build/release/bun-profile}; REF=${REF:-$S/link/ref/bun-profile}
L=/workspace/notes/lint/tools
P=/workspace/notes/lint/units/parser/round3/proof-cost/tools
M=/workspace/notes/lint/units/parser/measure
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
mkdir -p "$O"
[ -x "$REF" ] || { echo "no reference binary: mkref.sh, then cycle.sh ref \$S/root/reflink"; exit 1; }
# 1. sizes: parser text, the four P rows, the skipper by sink, the stripped binaries
for t in base ref head; do
  case $t in base) B=$BASE ;; ref) B=$REF ;; head) B=$HEAD ;; esac
  python3 $L/symsizes.py $B > $O/$t.sym.txt
  python3 $M/grammar-syms.py $B > $O/$t.grammar-syms.txt 2>/dev/null
done
stat -c '%s %n' /workspace/base/bun.f4d755a9c "$(dirname $HEAD)/bun" > $O/stripped.txt
# 2. machine code, function by function. ref against head is the acceptance; base against ref names the exceptions.
for k in js ts-scan skipper ts; do
  case $k in js) I='P<false, ?(false|true)>' ;; ts-scan) I='P<true, ?true>' ;; skipper) I='skip_type_?script|skip_typescript' ;; ts) I='P<true, ?false>' ;; esac
  python3 $P/fncmp.py $REF $HEAD --inst "$I" > $O/fncmp.$k.ref-head.txt
  python3 $P/fncmp.py $BASE $REF --inst "$I" > $O/fncmp.$k.base-ref.txt
done
python3 $P/lintcalls.py $HEAD > $O/lintcalls.js.head.txt
python3 $P/lintcalls.py $HEAD --inst 'P<true, ?true>' > $O/lintcalls.ts-scan.head.txt
# 3. counts in both VEX modes, transpiler cache of the run time off
for t in base ref head; do
  case $t in base) B=$BASE ;; ref) B=$REF ;; head) B=$HEAD ;; esac
  [ -f $O/$t.js-control.cg ] || $L/cgbench.sh $B $O $t 20 > $O/$t.jsonl
  [ -f $O/raw$t.js-control.cg ] || $P/cgbench-raw.sh $B $O raw$t 20 > $O/raw$t.jsonl
done
# the same work on every side: files, bytes, passes and output length of each group
for g in bun-types typescript-lib src-js tsx js-control; do for t in base ref head; do grep -A1 '^group' $O/raw$t.$g.log | tail -1 | cut -c1-72; done; done | uniq -c > $O/work.txt
# 4. the tables
python3 $P/r3table.py $O base ref --raw > $O/table.base-ref.txt
python3 $P/r3table.py $O ref head --raw > $O/table.ref-head.txt
python3 $P/r3table.py $O base head --raw > $O/table.base-head.txt
for g in bun-types typescript-lib src-js tsx js-control; do
  python3 $M/tools/cgdiff.py $O/rawref.$g.cg $O/rawhead.$g.cg --match bun_js_parser --top 60 > $O/cgdiff.raw.$g.ref-head.txt
  python3 $M/tools/cgdiff.py $O/rawbase.$g.cg $O/rawref.$g.cg --match bun_js_parser --top 60 > $O/cgdiff.raw.$g.base-ref.txt
done
# 5. executed tests of the side table, by site (a counting build through the loop, run without valgrind)
if [ ! -f $O/sites.txt ]; then
  python3 $P/sitecount.py $S/root/count --ref $S/root/ref > $O/sitecount.txt
  $P/cycle.sh count $S/root/count > $O/count.cycle.txt 2>&1
  mkdir -p $O/count
  for g in bun-types typescript-lib src-js tsx js-control; do
    BUN_LINT_TEST_COUNT=1 BUN_DEBUG_QUIET_LOGS=1 $S/link/count/bun-profile /workspace/notes/lint/benchroot/bench/snippets/transpiler-typescript.mjs --iterations=1 --group=$g > $O/count/$g.out 2> $O/count/$g.err
  done
  python3 $P/sitetable.py $S/root/count/sites.tsv $O/count > $O/sites.txt
fi
# 6. the text: shared files against the reference
python3 $P/siteaudit.py --ref $S/root/ref --head /workspace/wt/parser --sites ${ALLOW:+--allow $ALLOW} > $O/siteaudit.txt
# what to read
cat $O/base.sym.txt | head -5; cat $O/ref.sym.txt | head -5; cat $O/head.sym.txt | head -5; cat $O/stripped.txt
for k in js ts-scan skipper ts; do printf '%-8s ref-head  %s | %s\n' $k "$(head -1 $O/fncmp.$k.ref-head.txt)" "$(tail -1 $O/fncmp.$k.ref-head.txt)"; done
for k in js ts-scan skipper ts; do printf '%-8s base-ref  %s\n' $k "$(head -1 $O/fncmp.$k.base-ref.txt)"; done
tail -1 $O/lintcalls.js.head.txt; tail -1 $O/lintcalls.ts-scan.head.txt
cat $O/table.ref-head.txt; cat $O/table.base-ref.txt; tail -5 $O/sites.txt; tail -2 $O/siteaudit.txt; cat $O/work.txt
