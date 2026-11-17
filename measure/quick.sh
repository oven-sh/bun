#!/bin/bash
# quick.sh <build> : instructions of the verdict entry for the passing fixtures.
export PATH=/usr/lib/llvm-23/bin:$PATH
cd /tmp/repro-9089/measure
b=$1
sym=JSC__JSValue__jestDeepMatchTellingWhere
[ "$b" = base ] && sym=JSC__JSValue__jestDeepMatch
for name in plain3 plain10 pass3 pass10 matchers10; do
  out=$(MEASURE_MODE=insns MEASURE_SYMBOL=$sym MEASURE_SKIP=100 MEASURE_RUNS=2 BUN_JSC_useConcurrentJIT=0 timeout 900 gdb -q -batch -x measure.py --args /tmp/repro-9089/bin/bun-profile-$b test ./$name.test.js 2>&1 | grep RESULT | sed 's/.*-> //')
  printf "%s %s: %s\n" "$b" "$name" "${out:-NO RESULT}"
done
