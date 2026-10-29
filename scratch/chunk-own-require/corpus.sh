#!/bin/bash
# usage: corpus.sh <bun binary> <label>
# Builds every variant into /tmp/measure/out-<label>/ and writes sha256 of every output file to /tmp/measure/sums-<label>.txt
BUN=$1; LABEL=$2
export BUN_DEBUG_QUIET_LOGS=1
OUT=/tmp/measure/out-$LABEL
rm -rf $OUT; mkdir -p $OUT
cd /tmp/measure/corpus
build() { # name dir entries... -- flags
  local name=$1 dir=$2; shift 2
  ( cd $dir && $BUN build "$@" --outdir $OUT/$name >/dev/null 2>$OUT/$name.err ) || echo "BUILD FAILED $name: $(head -3 $OUT/$name.err)"
}
for target in bun node browser; do
  for min in plain minify; do
    m=""; [ $min = minify ] && m="--minify"
    for input in r1 r2 flat; do
      case $input in
        r1) entries="./src/a/entry.js ./src/b/entry.js"; ext="--external ./src/lib.js";;
        r2) entries="./src/a/entry.js ./src/b/entry.js"; ext="";;
        flat) entries="./src/a.js ./src/b.js"; ext="";;
      esac
      build $input-$target-$min-split        $input $entries $ext --target $target --format esm --splitting $m
      build $input-$target-$min-split-chunks $input $entries $ext --target $target --format esm --splitting --chunk-naming 'chunks/[name]-[hash].[ext]' $m
      build $input-$target-$min-unsplit      $input $entries $ext --target $target --format esm $m
      if [ $target != browser ]; then
        build $input-$target-$min-cjs        $input $entries $ext --target $target --format cjs $m
      fi
    done
  done
done
cd $OUT && find . -type f ! -name '*.err' | sort | xargs sha256sum > /tmp/measure/sums-$LABEL.txt
wc -l /tmp/measure/sums-$LABEL.txt
