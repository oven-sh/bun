#!/bin/sh
# Checks the JavaScript step of src/typecheck/importer/javascript with rustc alone (lib.rs of the crate does not declare the modules yet) and makes its fixtures again.
# usage: sh regen.sh [check|fixtures|corpus|sort|all]
# Needs: rustc, clippy-driver, rustfmt, bun, typescript 6.0.2 in /workspace/bun/node_modules, /tmp/rr/dumpast (../../ts-dump-and-test-importer/groundtruth/build.sh),
# a stand-in bun_core rlib (rustc --crate-type rlib of a file with StackCheck::init and is_safe_to_recurse), and for `corpus` the units in /tmp/tsimp/corpus with
# the goldens of ../run.sh in /tmp/jsdocrp/go-js.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${W:-/tmp/jsrp}
WT=/workspace/wt/typecheck
JS=$WT/src/typecheck/importer/javascript
BUN_CORE=${BUN_CORE:-/tmp/nt2/out/libbun_core.rlib}
what=${1:-check}
mkdir -p $W/out $W/js/node_modules $W/fx $W/fx-gold $W/fx-pre $W/fx-proto $W/pre-all $W/proto-all
rm -rf $W/src && cp -r $HERE/scratch $W/src
ln -sfn /workspace/bun/node_modules/typescript $W/js/node_modules/typescript
N=$HERE/../..
cp $HERE/../probe/dump-ast.ts $HERE/../probe/gotable.mjs $HERE/../probe/convert.mjs $HERE/../probe/reparse.mjs $HERE/../probe/jscheck.mjs $HERE/gen.ts $W/js/
cp $N/ts-dump-and-test-importer/top-down/probe/convert.mjs $W/js/convert-base.mjs
build() { (cd $W && rustc --edition 2024 --test --extern bun_core=$BUN_CORE --error-format=short -o out/tests src/lib.rs 2>&1 | grep -v '^warning' | grep -v '^$' || true); }
if [ "$what" = check ] || [ "$what" = all ]; then
  (cd $W && rustc --edition 2024 --crate-type lib --emit=metadata --extern bun_core=$BUN_CORE --error-format=short -o out/libjsrp.rmeta src/lib.rs)
  FLAGS=$(cat $N/conventions-scratch/data/clippy_flags.txt)
  (cd $W && CLIPPY_CONF_DIR=$WT clippy-driver --edition 2024 --crate-type lib --emit=metadata --extern bun_core=$BUN_CORE --error-format=short -o out/libclippy.rmeta src/lib.rs -D warnings -W clippy::all -D dead_code -D unreachable_pub -D unused_imports -D unused_variables -D unused_mut $FLAGS 2>&1 | grep 'importer/\|ast/builder' || true)
  rustfmt --edition 2024 --config-path $WT/rustfmt.toml --check $JS/*.rs $JS/../mod.rs
  build && $W/out/tests javascript
fi
if [ "$what" = fixtures ] || [ "$what" = all ]; then
  # The sources are fixtures/*.js. A fixture is kept when the step gives the tree of the reference byte for byte.
  cp $HERE/fixtures/*.js $W/fx/ && rm -f $W/fx-gold/* $W/fx-pre/*
  (cd $W/fx && /tmp/rr/dumpast $W/fx-gold $(for f in *.js; do echo "$f=$W/fx/$f"; done))
  (cd $W/js && CORPUS=$W/fx OUT=$W/fx-pre PROTO=$W/fx-proto bun gen.ts)
  for f in $W/fx/*.js; do n=$(basename $f); cp $f $JS/testdata/$n.txt; sed '1{/^parseDiagnostics/d}' $W/fx-pre/$n.tree > $JS/testdata/$n.tree; cp $W/fx-gold/$n.tsgo.txt $JS/testdata/$n.tsgo.txt; done
  build && PRE=$W/fx-pre GOLD=$W/fx-gold REPORT=$W/out/report-fx.tsv OUTDIR=$W/out/trees-fx $W/out/tests corpus::corpus --ignored --nocapture | grep '^units'
fi
if [ "$what" = corpus ] || [ "$what" = all ]; then
  (cd $W/js && CORPUS=/tmp/tsimp/corpus OUT=$W/pre-all PROTO=$W/proto-all bun gen.ts)
  build
  RUST_MIN_STACK=2000000000 PRE=$W/pre-all GOLD=/tmp/jsdocrp/go-js REPORT=$W/out/report-all.tsv OUTDIR=$W/out/trees-all $W/out/tests corpus::corpus --ignored --nocapture | grep '^units'
  RUST_MIN_STACK=2000000000 PRE=$W/pre-all GOLD=/tmp/jsdocrp/go-js $W/out/tests corpus::indicators --ignored --nocapture | grep 'indicator'
  # the trees of the step against the trees of the research prototype (probe/convert.mjs with probe/reparse.mjs)
  diff -rq $W/out/trees-all $W/proto-all | grep -c differ || true
fi
if [ "$what" = sort ] || [ "$what" = all ]; then
  (cd $HERE/gosort && GO111MODULE=off /tmp/rr/go126/bin/go run main.go > $JS/testdata/go_sort_func.txt)
fi
