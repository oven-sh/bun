#!/bin/bash
# Runs the http2 suites on the debug build, one after the other.
cd /workspace/bun
B=/workspace/bun/build/debug/bun-debug
OUT=/tmp/h2repro/final/suites
: > $OUT/summary.txt
export BUN_DEBUG_QUIET_LOGS=1
for f in test/js/node/http2/*.test.*; do
  n=$(basename $f)
  timeout 1500 $B test $f --timeout 60000 > $OUT/dir-$n.txt 2>&1
  echo "dir $n exit=$? $(grep -E '^ *[0-9]+ (pass|fail|skip)' $OUT/dir-$n.txt | tr -s ' ' | tr '\n' ' ')" >> $OUT/summary.txt
done
pass=0; fail=0
for f in test/js/node/test/parallel/test-http2-*.js test/js/node/test/sequential/test-http2-*.js; do
  [ -f "$f" ] || continue
  n=$(basename $f)
  timeout 180 $B $f > $OUT/node-$n.txt 2>&1
  rc=$?
  if [ $rc -eq 0 ]; then pass=$((pass+1)); rm -f $OUT/node-$n.txt; else fail=$((fail+1)); echo "nodetest FAIL $n exit=$rc" >> $OUT/summary.txt; fi
done
echo "nodetests pass=$pass fail=$fail" >> $OUT/summary.txt
for f in test/js/third_party/grpc-js/*.test.*; do
  n=$(basename $f)
  timeout 1500 $B test $f --timeout 60000 > $OUT/grpc-$n.txt 2>&1
  echo "grpc $n exit=$? $(grep -E '^ *[0-9]+ (pass|fail|skip)' $OUT/grpc-$n.txt | tr -s ' ' | tr '\n' ' ')" >> $OUT/summary.txt
done
echo DONE >> $OUT/summary.txt
