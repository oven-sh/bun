#!/bin/sh
# One turn of the loop that stands in for a release build: compile a copy of src/js_parser with the rustc command of the
# release build, link bun-profile again with that one rlib replaced, and compare the machine code with the reference.
# usage: /workspace/tools/lk cycle.sh <tag> [<tree>] [cg]
#   <tree>  the tree whose src/js_parser is copied (default /workspace/wt/parser); a tree under $S/root is used in place
#   cg      also count js-control under cachegrind with --vex-guest-chase=no and print the difference to the reference
# Needs: a finished release build in /workspace/wt/parser/build/release whose other crates are the ones of the worktree,
# and the reference of mkref.sh linked once as tag `ref` (cycle.sh ref $S/root/reflink).
# Output: $S/link/<tag>/bun-profile, $S/check/<tag>.*.txt. Nothing is written into the worktree.
S=${S:-/tmp/costproof}
T=/workspace/notes/lint/units/parser/paren-expr-seam
P=/workspace/notes/lint/units/parser/round3/proof-cost/tools
TAG=$1; TREE=${2:-/workspace/wt/parser}
R=/workspace/bun/build/release
LINTONLY=${LINTONLY:-'parse::(erased|wrappers|attached|generics|syntax_errors|lint[a-z_]*)::|ForLint|for_lint|type_sink::Build|::lint_[a-z_]+'}
RLIB=$(basename "$(ls $R/rust-target/x86_64-unknown-linux-gnu/deps/libbun_js_parser-*.rlib | head -1)")
mkdir -p $S/root $S/out $S/link $S/check
case "$TREE" in
  $S/root/*) ROOT=$TREE ;;
  *) ROOT=$S/root/$TAG; rm -rf "$ROOT"; mkdir -p "$ROOT/src"; cp -r "$TREE/src/js_parser" "$ROOT/src/" ;;
esac
t0=$(date +%s)
OUT=$S/out RELAX=1 python3 $T/run.py "$TAG" "$ROOT" || exit 1
t1=$(date +%s)
export OUT=$S/link CACHE=$S/thinlto-cache
rm -f $S/link/$TAG/bun-profile
python3 $T/relink.py "$TAG" "$S/out/$TAG/$RLIB" full > $S/check/$TAG.link.txt 2>&1
if [ ! -x $S/link/$TAG/bun-profile ]; then
  # the crates of the release build name symbols that this copy lacks: link anyway and list them
  ( cd $R && sh -c "$(cat $S/link/$TAG/link.cmd) -Wl,--warn-unresolved-symbols -Wl,--error-limit=0" > $S/link/$TAG/link.unresolved.log 2>&1 )
  grep 'undefined symbol' $S/link/$TAG/link.unresolved.log | sed 's/.*undefined symbol: //' | sort -u > $S/check/$TAG.unresolved.txt
  echo "$TAG: linked with $(wc -l < $S/check/$TAG.unresolved.txt) unresolved symbols ($S/check/$TAG.unresolved.txt)"
  # a name in that list that is not of the lint parse means that the release build and this copy number the impl blocks of a
  # module differently (v0 mangling), or that the copy lacks a shared generic instantiation (-Zshare-generics): ThinLTO then
  # drops what only that name reaches, functions go missing from the binary, and the comparison below is void
  grep -vE "$LINTONLY" $S/check/$TAG.unresolved.txt > $S/check/$TAG.stale.txt
  [ -s $S/check/$TAG.stale.txt ] && { echo "   STALE: $(wc -l < $S/check/$TAG.stale.txt) unresolved names are not lint-only ($S/check/$TAG.stale.txt):"; head -5 $S/check/$TAG.stale.txt | sed 's/^/      /'; }
fi
t2=$(date +%s)
[ -x $S/link/$TAG/bun-profile ] || { echo "$TAG: no binary"; tail -5 $S/link/$TAG/link.unresolved.log; exit 1; }
echo "$TAG: compile $((t1 - t0)) s, link $((t2 - t1)) s"
if [ "$TAG" != ref ] && [ -x $S/link/ref/bun-profile ]; then
  for k in js ts-scan skipper ts; do
    case $k in
      js) I='P<false, ?(false|true)>' ;;
      ts-scan) I='P<true, ?true>' ;;
      skipper) I='skip_type_?script|skip_typescript' ;;
      ts) I='P<true, ?false>' ;;
    esac
    python3 $P/fncmp.py $S/link/ref/bun-profile $S/link/$TAG/bun-profile --inst "$I" > $S/check/$TAG.fncmp.$k.txt
    printf '%-8s %s | %s\n' $k "$(head -1 $S/check/$TAG.fncmp.$k.txt)" "$(tail -1 $S/check/$TAG.fncmp.$k.txt)"
  done
  python3 /workspace/notes/lint/tools/symsizes.py $S/link/$TAG/bun-profile > $S/check/$TAG.sym.txt; head -5 $S/check/$TAG.sym.txt
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
