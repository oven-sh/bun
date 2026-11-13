#!/bin/bash
# usage: counts-of.sh <binary> <symbols file> <out file>
bin=$1; syms=$2; out=$3; : > $out
one() { echo "== $*" >> $out; bash /tmp/measure/count.sh $bin $syms "$@" >> $out 2>&1; }
one sources ./src/extra.ts
one define200
one definebare200
one definenamed200
one assign1
one assign20
one assign200
one assignnamed200
one assign200 --minify-identifiers
