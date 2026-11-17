#!/bin/bash
# run-measure3.sh <insns|calls> : base (#48544 head) against the new build, where the verdict entry is the same function.
mode=$1
export PATH=/usr/lib/llvm-23/bin:$PATH
cd /tmp/repro-9089/measure
JDM=JSC__JSValue__jestDeepMatch
ROWS=JSC__JSValue__jestMatchedRows
BDM=_ZN3Bun20functionBunDeepMatchEPN3JSC14JSGlobalObjectEPNS0_9CallFrameE
HOST=_Z39jsExpectPrototypeFunction_toMatchObjectPN3JSC14JSGlobalObjectEPNS_9CallFrameE
one() { # name build symbol label
  out=$(MEASURE_MODE=$mode MEASURE_SYMBOL=$3 MEASURE_SKIP=100 MEASURE_RUNS=${RUNS:-3} BUN_JSC_useConcurrentJIT=0 timeout 900 gdb -q -batch -x measure.py --args /tmp/repro-9089/bin/bun-profile-$2 test ./$1.test.js 2>&1 | grep RESULT | sed 's/.*-> //')
  echo "$mode $1 [$4] $2: ${out:-NO RESULT}"
}
for name in ${FIXTURES:-pass3 pass10 plain3 plain10 plain40 matchers10 nest4 not3 snapshot}; do one $name base $JDM verdict; one $name new $JDM verdict; done
for name in ${HOSTFIXTURES:-pass3 plain10}; do one $name base $HOST host-call; one $name new $HOST host-call; done
one deepmatch base $BDM Bun.deepMatch; one deepmatch new $BDM Bun.deepMatch
one custom base ExpectCustomAsymmetricMatcher__execute ask; one custom new ExpectCustomAsymmetricMatcher__execute ask
one custom-sym base Bun__Expect__applyCustomMatcher call; one custom-sym new Bun__Expect__applyCustomMatcher call
one custom-equals base ExpectCustomAsymmetricMatcher__execute ask; one custom-equals new ExpectCustomAsymmetricMatcher__execute ask
for name in fail-repro fail-10 fail-last fail-plain10; do
  one $name base $JDM verdict+rows; one $name new $JDM verdict+rows; one $name new $ROWS collect
  one $name base $HOST host-call; one $name new $HOST host-call
done
