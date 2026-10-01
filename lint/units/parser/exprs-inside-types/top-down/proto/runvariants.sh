#!/bin/sh
# usage: runvariants.sh V1 V2 ...   compiles each variant of the prototype and compares its grammar functions with base
P=/workspace/notes/lint/units/parser/exprs-inside-types/top-down/proto/patch.py
Q=/workspace/notes/lint/units/parser/build-sink-positions/quick
for v in "$@"; do
  rm -rf /tmp/eit/src/v_$v && cp -r /tmp/eit/src/base /tmp/eit/src/v_$v && python3 $P /tmp/eit/src/v_$v $(echo $v | sed s/_noenum//) || exit 1
  RELAX=1 OUT=/tmp/eit/out python3 $Q/run.py v_$v /tmp/eit/src/v_$v
  echo "### base vs $v (grammar functions, P<true,false> only)"
  python3 $Q/scmp.py /tmp/eit/out/base/bun_js_parser-185fe25973f3a1f8.s /tmp/eit/out/v_$v/bun_js_parser-185fe25973f3a1f8.s | grep -v "P<true, true>"
done
