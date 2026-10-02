#!/bin/sh
# Scratch experiment of the research pass: the loop on the crates of main (build/release = main at bc7a813b10).
#   base       main's src/js_parser (only compiled: its bitcode must equal the rlib of the release build)
#   ref0       main + sink form + boxed tables (no MDot edit: main's bun_ast has the Vec form)
#   site1      ref0 + six sites `if p.lint() { cold call }` in shared files
#   site1count site1 with a counter at every test
S=/tmp/costproof
T=/workspace/notes/lint/units/parser/paren-expr-seam
P=/workspace/notes/lint/units/parser/round3/proof-cost/tools
L=/workspace/notes/lint/tools
M=/workspace/notes/lint/units/parser/measure
R=/workspace/bun/build/release
RLIB=$(basename "$(ls $R/rust-target/x86_64-unknown-linux-gnu/deps/libbun_js_parser-*.rlib | head -1)")
BASE=/workspace/base/bun-profile.bc7a813b1
BENCH=/workspace/notes/lint/benchroot/bench/snippets/transpiler-typescript.mjs
mkdir -p $S/out $S/link $S/check $S/arx/rel $S/arx/base $S/cg $S/count
echo "start $(date +%T) load $(cut -d' ' -f1 /proc/loadavg)"
for t in base ref0 site1 site1count; do
  t0=$(date +%s)
  OUT=$S/out RELAX=1 python3 $T/run.py $t $S/root/$t
  echo "compile $t $(( $(date +%s) - t0 )) s"
done
(cd $S/arx/rel && llvm-ar x $R/rust-target/x86_64-unknown-linux-gnu/deps/$RLIB)
(cd $S/arx/base && llvm-ar x $S/out/base/$RLIB)
cmp $S/arx/rel/*.rcgu.o $S/arx/base/*.rcgu.o && echo "base bitcode identical to the release rlib"
for t in ref0 site1 site1count; do
  t0=$(date +%s)
  OUT=$S/link CACHE=$S/thinlto-cache python3 $T/relink.py $t $S/out/$t/$RLIB full
  echo "link $t $(( $(date +%s) - t0 )) s  $(date +%T)"
done
ls -la $S/link/*/bun-profile
for k in all js ts-scan skipper ts; do
  case $k in all) I='.' ;; js) I='P<false, ?(false|true)>' ;; ts-scan) I='P<true, ?true>' ;; skipper) I='skip_type_?script|skip_typescript' ;; ts) I='P<true, ?false>' ;; esac
  python3 $P/fncmp.py $BASE $S/link/ref0/bun-profile --inst "$I" --all > $S/check/base-ref0.fncmp.$k.txt
  python3 $P/fncmp.py $S/link/ref0/bun-profile $S/link/site1/bun-profile --inst "$I" --all > $S/check/ref0-site1.fncmp.$k.txt
  printf '%-8s base-ref0  %s | %s\n' $k "$(head -1 $S/check/base-ref0.fncmp.$k.txt)" "$(tail -1 $S/check/base-ref0.fncmp.$k.txt)"
  printf '%-8s ref0-site1 %s | %s\n' $k "$(head -1 $S/check/ref0-site1.fncmp.$k.txt)" "$(tail -1 $S/check/ref0-site1.fncmp.$k.txt)"
done
python3 $L/symsizes.py $BASE > $S/check/base.sym.txt
for t in ref0 site1; do python3 $L/symsizes.py $S/link/$t/bun-profile > $S/check/$t.sym.txt; python3 $M/grammar-syms.py $S/link/$t/bun-profile > $S/check/$t.grammar-syms.txt; done
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
# executed tests by site: the counting build, without valgrind
for g in bun-types typescript-lib src-js tsx js-control; do
  BUN_LINT_TEST_COUNT=1 BUN_DEBUG_QUIET_LOGS=1 $S/link/site1count/bun-profile $BENCH --iterations=1 --group=$g > $S/count/$g.out 2> $S/count/$g.err
done
python3 $P/sitetable.py $S/root/site1count/sites.tsv $S/count > $S/check/sites.txt 2>&1
cg() { # cg <raw|def> <binary> <tag>
  t0=$(date +%s)
  if [ "$1" = raw ]; then $P/cgbench-raw.sh "$2" $S/cg "$3" 20 > $S/cg/$3.jsonl; else $L/cgbench.sh "$2" $S/cg "$3" 20 > $S/cg/$3.jsonl; fi
  echo "cg $3 $(( $(date +%s) - t0 )) s  $(date +%T)"
}
cg raw $S/link/ref0/bun-profile rawref0
cg raw $S/link/site1/bun-profile rawsite1
cg raw $BASE rawbase
cg def $S/link/ref0/bun-profile ref0
cg def $S/link/site1/bun-profile site1
python3 $P/r3table.py $S/cg ref0 site1 --raw > $S/check/table.ref0-site1.txt 2>&1
python3 $P/r3table.py $S/cg base ref0 --raw > $S/check/table.base-ref0.txt 2>&1
echo "done $(date +%T)"
