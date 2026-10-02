#!/bin/sh
# One turn of the loop that stands in for a release build (cycle.sh of ../tools, with the comparisons by function body):
# compile a copy of src/js_parser with the rustc command of the release build, link bun-profile again with that one rlib
# replaced, compare the machine code with the reference binary and, on request, count the benchmark.
# usage: /workspace/tools/lk r3cycle.sh <tag> [<tree>] [cg|cgjs]
#   <tree>   the tree whose src/js_parser is copied (default /workspace/wt/parser); a tree under $S/root is used in place
#   cgjs     count js-control (--vex-guest-chase=no) and print the difference to the reference by function body
#   cg       count all five groups and print the table with the executed tests of the side table
# Environment: S scratch (default /tmp/costproof); NOBUILD=1 takes $S/link/<tag>/bun-profile as it is;
#   LINTONLY regex of the names that only a lint parse reaches; SITE regex of the line of a site (see cgclass.py).
# Needs: a finished release build in /workspace/wt/parser/build/release whose OTHER crates are the ones of the tree (an
# edit outside src/js_parser, src/ast/ts.rs too, needs `bun run build:release` first), and the reference linked once as
# tag `ref` (mkref.sh, then r3cycle.sh ref $S/root/reflink).
# Output: $S/link/<tag>/bun-profile, $S/check/<tag>.*.txt, $S/cg/raw<tag>.<group>.cg. Nothing is written into the worktree.
S=${S:-/tmp/costproof}
T=/workspace/notes/lint/units/parser/paren-expr-seam
P=/workspace/notes/lint/units/parser/round3/proof-cost/tools
H=$(cd "$(dirname "$0")" && pwd)
L=/workspace/notes/lint/tools
TAG=$1; TREE=${2:-/workspace/wt/parser}; MODE=$3
R=/workspace/bun/build/release
LINTONLY=${LINTONLY:-'parse::(erased|wrappers|attached|generics|syntax_errors|lint[a-z_]*)::|ForLint|for_lint|type_sink::Build|::lint_[a-z_]+'}
mkdir -p $S/root $S/out $S/link $S/check $S/cg
case "$TREE" in
  $S/root/*) ROOT=$TREE ;;
  *) ROOT=$S/root/$TAG; [ -n "$NOBUILD" ] || { rm -rf "$ROOT"; mkdir -p "$ROOT/src"; cp -r "$TREE/src/js_parser" "$ROOT/src/"; } ;;
esac
if [ -z "$NOBUILD" ]; then
  RLIB=$(basename "$(ls $R/rust-target/x86_64-unknown-linux-gnu/deps/libbun_js_parser-*.rlib | head -1)")
  t0=$(date +%s)
  OUT=$S/out RELAX=1 python3 $T/run.py "$TAG" "$ROOT" || exit 1
  t1=$(date +%s)
  rm -f $S/link/$TAG/bun-profile
  OUT=$S/link CACHE=$S/thinlto-cache python3 $T/relink.py "$TAG" "$S/out/$TAG/$RLIB" full > $S/check/$TAG.link.txt 2>&1
  if [ ! -x $S/link/$TAG/bun-profile ]; then
    # the crates of the release build name symbols that this copy lacks: link anyway and list them
    ( cd $R && sh -c "$(cat $S/link/$TAG/link.cmd) -Wl,--warn-unresolved-symbols -Wl,--error-limit=0" > $S/link/$TAG/link.unresolved.log 2>&1 )
    grep 'undefined symbol' $S/link/$TAG/link.unresolved.log | sed 's/.*undefined symbol: //' | sort -u > $S/check/$TAG.unresolved.txt
    echo "$TAG: linked with $(wc -l < $S/check/$TAG.unresolved.txt) unresolved symbols ($S/check/$TAG.unresolved.txt)"
    # a name in that list that is not of the lint parse: the release build and this copy number the impl blocks of a module
    # differently (v0 mangling), or the copy lacks a shared generic instantiation (-Zshare-generics). The comparison is void.
    grep -vE "$LINTONLY" $S/check/$TAG.unresolved.txt > $S/check/$TAG.stale.txt
    [ -s $S/check/$TAG.stale.txt ] && { echo "   STALE: $(wc -l < $S/check/$TAG.stale.txt) unresolved names are not lint-only ($S/check/$TAG.stale.txt):"; head -5 $S/check/$TAG.stale.txt | sed 's/^/      /'; }
  fi
  t2=$(date +%s)
  [ -x $S/link/$TAG/bun-profile ] || { echo "$TAG: no binary"; tail -5 $S/link/$TAG/link.unresolved.log; exit 1; }
  echo "$TAG: compile $((t1 - t0)) s, link $((t2 - t1)) s"
fi
B=$S/link/$TAG/bun-profile; REF=$S/link/ref/bun-profile
[ -x $B ] || { echo "$TAG: no binary $B"; exit 1; }
python3 $L/symsizes.py $B > $S/check/$TAG.sym.txt; head -5 $S/check/$TAG.sym.txt
[ "$TAG" != ref ] && [ -x $REF ] || exit 0
# what JavaScript and every scan-only parse run: the same machine code as the reference, lint-only additions apart
python3 $H/fncmp2.py $REF $B --strict --allow-only-b "$LINTONLY" > $S/check/$TAG.fncmp.strict.txt
printf 'strict   %s | %s\n' "$(head -1 $S/check/$TAG.fncmp.strict.txt)" "$(tail -1 $S/check/$TAG.fncmp.strict.txt)"
grep -E '^(DIFF|ONLY-A|ONLY-B|CONSTS)' $S/check/$TAG.fncmp.strict.txt | head -12
# the skipper: both sinks as in the reference
python3 $H/fncmp2.py $REF $B --inst 'skip_type_?script|skip_typescript' > $S/check/$TAG.fncmp.skipper.txt
printf 'skipper  %s | %s\n' "$(head -1 $S/check/$TAG.fncmp.skipper.txt)" "$(tail -1 $S/check/$TAG.fncmp.skipper.txt)"
# a parse of TypeScript: the functions that differ are the ones that hold a site
python3 $H/fncmp2.py $REF $B --ts --allow-only-b "$LINTONLY" > $S/check/$TAG.fncmp.ts.txt
printf 'ts       %s\n' "$(head -1 $S/check/$TAG.fncmp.ts.txt)"
python3 $P/optsites.py $B --inst '^(?!.*(<true, ?false>|_parse::?<true>))' > $S/check/$TAG.optsites.strict.txt; printf 'strict   %s\n' "$(tail -1 $S/check/$TAG.optsites.strict.txt)"
[ -f $S/check/ref.optsites.strict.txt ] || python3 $P/optsites.py $REF --inst '^(?!.*(<true, ?false>|_parse::?<true>))' > $S/check/ref.optsites.strict.txt
printf 'ref      %s\n' "$(tail -1 $S/check/ref.optsites.strict.txt)"
[ -n "$MODE" ] || exit 0
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
BENCH=/workspace/notes/lint/benchroot/bench/snippets/transpiler-typescript.mjs
GROUPS="js-control"; [ "$MODE" = cg ] && GROUPS="bun-types typescript-lib src-js tsx js-control"
# every binary is counted from one path and one working directory: start-up code that shares a body with the parser
# (identical code folding) depends on the path of the executable
RUN=$S/run; mkdir -p $RUN
for t in ref $TAG; do
  f=$(readlink -f $S/link/$t/bun-profile); ln -f "$f" $RUN/bun-profile 2>/dev/null || cp -f "$f" $RUN/bun-profile
  for g in $GROUPS; do
    [ -f $S/cg/raw$t.$g.cg ] && { [ $t = ref ] || [ -n "$NOBUILD" ]; } && continue
    ( cd $RUN && BUN_JSC_useJIT=0 BUN_DEBUG_QUIET_LOGS=1 /workspace/tools/vg --tool=cachegrind --cache-sim=no --branch-sim=yes --vex-guest-chase=no \
        --cachegrind-out-file=$S/cg/raw$t.$g.cg $RUN/bun-profile $BENCH --iterations=20 --group=$g > $S/cg/raw$t.$g.log 2>&1 ) &
  done
  wait
done
for g in $GROUPS; do
  echo "== $g"
  python3 $H/cgclass.py $REF $S/cg/rawref.$g.cg $B $S/cg/raw$TAG.$g.cg --src "$ROOT" ${SITE:+--site "$SITE"} --top 12 | tail -n +3 | cut -c1-200
done
[ "$MODE" = cg ] && python3 $H/r3table2.py $S/cg ref $REF $TAG $B --src "$ROOT" ${SITE:+--site "$SITE"} --no-default
exit 0
