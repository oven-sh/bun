#!/bin/bash
# run-measure4.sh <insns|calls> : base (#48544 head) against the new build. A positive toMatchObject enters C++ through
# JSC__JSValue__jestDeepMatch on the base and through JSC__JSValue__jestDeepMatchForDiff on the new build.
mode=$1
export PATH=/usr/lib/llvm-23/bin:$PATH
cd /tmp/repro-9089/measure
JDM=JSC__JSValue__jestDeepMatch
DIFF=JSC__JSValue__jestDeepMatchForDiff
BDM=_ZN3Bun20functionBunDeepMatchEPN3JSC14JSGlobalObjectEPNS0_9CallFrameE
HOST=_Z39jsExpectPrototypeFunction_toMatchObjectPN3JSC14JSGlobalObjectEPNS_9CallFrameE
EQ=_Z33jsExpectPrototypeFunction_toEqualPN3JSC14JSGlobalObjectEPNS_9CallFrameE
one() { # name build symbol label [runs]
  out=$(MEASURE_MODE=$mode MEASURE_SYMBOL=$3 MEASURE_SKIP=100 MEASURE_RUNS=${5:-3} BUN_JSC_useConcurrentJIT=0 timeout 1700 gdb -q -batch -x measure.py --args /tmp/repro-9089/bin/bun-profile-$2 test ./$1.test.js 2>&1 | grep RESULT | sed 's/.*-> //')
  echo "$mode $1 [$4] $2: ${out:-NO RESULT}"
}
for name in pass3 pass10 plain3 plain10 plain40 matchers10 nest4; do one $name base $JDM verdict; one $name new $DIFF verdict; done
for name in not3 snapshot; do one $name base $JDM verdict; one $name new $JDM verdict; done
for name in pass3 plain10; do one $name base $HOST host-call; one $name new $HOST host-call; done
one deepmatch base $BDM Bun.deepMatch; one deepmatch new $BDM Bun.deepMatch
one containing base $EQ host-call; one containing new $EQ host-call
one custom base ExpectCustomAsymmetricMatcher__execute ask; one custom new ExpectCustomAsymmetricMatcher__execute ask
one custom-sym base Bun__Expect__applyCustomMatcher call; one custom-sym new Bun__Expect__applyCustomMatcher call
one custom-equals base ExpectCustomAsymmetricMatcher__execute ask; one custom-equals new ExpectCustomAsymmetricMatcher__execute ask
one resolves base Expect_readFlagsAndProcessPromise ask; one resolves new Expect_readFlagsAndProcessPromise ask
one resolves base $EQ host-call; one resolves new $EQ host-call
for name in fail-repro fail-10 fail-last fail-plain10; do
  one $name base $JDM verdict+rows; one $name new $DIFF verdict+rows
  one $name base $HOST host-call; one $name new $HOST host-call
done
if [ "$mode" = insns ]; then
  for name in fail-records10 fail-records10m; do
    one $name base $JDM verdict+rows; one $name new $DIFF verdict+rows
    one $name base $HOST host-call 1; one $name new $HOST host-call 1
  done
fi
