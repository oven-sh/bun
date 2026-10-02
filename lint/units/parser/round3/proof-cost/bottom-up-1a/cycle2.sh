#!/bin/sh
# One turn of the loop that stands in for a release build: compile a copy of src/js_parser with the rustc command of the
# release build (about 15 s), link bun-profile again with that one rlib replaced (about 3 min with the ThinLTO cache, 4 min
# the first time), and compare every parser function with the reference binary.
# usage: /workspace/tools/lk cycle2.sh <tag> [<tree>] [cg]
#   <tree>  the tree whose src/js_parser is copied (default /workspace/wt/parser); a tree under $S/root is used in place
#   cg      also count js-control with --vex-guest-chase=no and print the difference to the reference
# Needs: a finished release build in /workspace/bun/build/release whose other crates are the ones of the tree, and the
# reference linked once as tag `ref` (mkref.sh, then cycle2.sh ref $S/root/reflink, or $S/root/ref when nothing is unresolved).
# Output: $S/link/<tag>/bun-profile, $S/check/<tag>.*.txt. Nothing is written into the worktree.
S=${S:-/tmp/costproof}
T=/workspace/notes/lint/units/parser/paren-expr-seam
P=/workspace/notes/lint/units/parser/round3/proof-cost/tools
P2=${P2:-/workspace/notes/lint/units/parser/round3/proof-cost/bottom-up-1a}
TAG=$1; TREE=${2:-/workspace/wt/parser}
R=/workspace/bun/build/release
LINTONLY=${LINTONLY:-'parse::(lint[a-z_]*|erased|wrappers|attached|generics|syntax_errors)::|ForLint|for_lint|type_sink::Build|::lint_[a-z_]+'}
RLIB=$(basename "$(ls $R/rust-target/x86_64-unknown-linux-gnu/deps/libbun_js_parser-*.rlib | head -1)")
mkdir -p $S/root $S/out $S/link $S/check
case "$TREE" in
  $S/root/*) ROOT=$TREE ;;
  *) ROOT=$S/root/$TAG; rm -rf "$ROOT"; mkdir -p "$ROOT/src"; cp -r "$TREE/src/js_parser" "$ROOT/src/" ;;
esac
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
  python3 $P2/stale.py $S/check/$TAG.unresolved.txt "$ROOT" "${HEADTREE:-/workspace/wt/parser}" --lint "$LINTONLY" > $S/check/$TAG.stale.txt
  [ -s $S/check/$TAG.stale.txt ] && { echo "   STALE: $(wc -l < $S/check/$TAG.stale.txt) unresolved names are not lint-only: the comparison is void, run the release build ($S/check/$TAG.stale.txt):"; head -5 $S/check/$TAG.stale.txt | sed 's/^/      /'; }
fi
t2=$(date +%s)
[ -x $S/link/$TAG/bun-profile ] || { echo "$TAG: no binary"; tail -5 $S/link/$TAG/link.unresolved.log; exit 1; }
echo "$TAG: compile $((t1 - t0)) s, link $((t2 - t1)) s"
rc=0
if [ "$TAG" != ref ] && [ -x $S/link/ref/bun-profile ]; then
  TREES=; [ -d $S/root/ref/src/js_parser ] && TREES="--trees $S/root/ref,$ROOT"
  python3 $P2/tsdiff.py $S/link/ref/bun-profile $S/link/$TAG/bun-profile --lint "$LINTONLY" $TREES ${EXCEPT:+--except "$EXCEPT"} > $S/check/$TAG.tsdiff.txt; rc=$?
  grep -E '^(SHARED|MOVED|OTHER|GONE)' $S/check/$TAG.tsdiff.txt | head -20
  tail -2 $S/check/$TAG.tsdiff.txt
  python3 $P/fncmp.py $S/link/ref/bun-profile $S/link/$TAG/bun-profile --inst 'skip_type_?script|skip_typescript' > $S/check/$TAG.fncmp.skipper.txt
  printf 'skipper  %s | %s\n' "$(head -1 $S/check/$TAG.fncmp.skipper.txt)" "$(tail -1 $S/check/$TAG.fncmp.skipper.txt)"
  python3 /workspace/notes/lint/tools/symsizes.py $S/link/$TAG/bun-profile > $S/check/$TAG.sym.txt; head -6 $S/check/$TAG.sym.txt
fi
if [ "$3" = cg ]; then
  export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
  mkdir -p $S/cg
  for t in ref $TAG; do
    [ -f $S/cg/raw$t.js-control.cg ] && [ $t = ref ] && continue
    BUN_JSC_useJIT=0 BUN_DEBUG_QUIET_LOGS=1 /workspace/tools/vg --tool=cachegrind --cache-sim=no --branch-sim=yes --vex-guest-chase=no \
      --cachegrind-out-file=$S/cg/raw$t.js-control.cg $S/link/$t/bun-profile /workspace/notes/lint/benchroot/bench/snippets/transpiler-typescript.mjs --iterations=20 --group=js-control > $S/cg/raw$t.js-control.log 2>&1 &
  done
  wait
  python3 /workspace/notes/lint/units/parser/measure/tools/cgdiff.py $S/cg/rawref.js-control.cg $S/cg/raw$TAG.js-control.cg --match bun_js_parser --top 20 | head -24
fi
exit $rc
