#!/bin/bash
# usage: build-all.sh <bun-binary> <outdir>
# Builds the 15 fixture sheets with target browser|bun, minify off|on.
BIN=$1; OUT=$2
FILES=/workspace/bun/test/js/bun/css/files
rm -rf "$OUT"; mkdir -p "$OUT"
for f in $FILES/*.css; do
  b=$(basename $f .css)
  for t in browser bun; do
    for m in "" "--minify"; do
      d="$OUT/$t${m:+-min}"
      mkdir -p "$d"
      BUN_DEBUG_QUIET_LOGS=1 "$BIN" build "$f" --target=$t $m --outfile "$d/$b.css" >/dev/null 2>"$d/$b.err" || echo "FAIL $b $t $m"
    done
  done
done
