#!/bin/bash
# run-measure2.sh <insns|calls> : base against the new build. One line per fixture, symbol and build.
mode=$1
export PATH=/usr/lib/llvm-23/bin:$PATH
cd /tmp/repro-9089/measure
JDM=JSC__JSValue__jestDeepMatch
TW=JSC__JSValue__jestDeepMatchTellingWhere
ROWS=JSC__JSValue__jestMatchedRows
BDM=_ZN3Bun20functionBunDeepMatchEPN3JSC14JSGlobalObjectEPNS0_9CallFrameE
HOST=$(llvm-nm --defined-only /tmp/repro-9089/bin/bun-profile-new | awk '{print $3}' | grep -E "^_Z39jsExpectPrototypeFunction_toMatchObject" | head -1)
DMT_BASE=_Z14Bun__deepMatchILb1EEbN3JSC7JSValueES1_PNS0_14JSGlobalObjectERNS0_10ThrowScopeERN3Bun14DeepMatchStateEb
DMT_NEW=$(llvm-nm --defined-only /tmp/repro-9089/bin/bun-profile-new | awk '{print $3}' | grep "^_Z14Bun__deepMatchILb1ELN3Bun13DeepMatchWalkE0EE")
one() { # name build symbol label
  out=$(MEASURE_MODE=$mode MEASURE_SYMBOL=$3 MEASURE_SKIP=100 MEASURE_RUNS=${RUNS:-3} BUN_JSC_useConcurrentJIT=0 timeout 900 gdb -q -batch -x measure.py --args /tmp/repro-9089/bin/bun-profile-$2 test ./$1.test.js 2>&1 | grep RESULT | sed 's/.*-> //')
  echo "$mode $1 [$4] $2: ${out:-NO RESULT}"
}
for name in ${FIXTURES:-pass3 pass10 plain3 plain10 matchers10}; do one $name base $JDM verdict; one $name new $TW verdict; done
for name in ${FIXTURES2:-not3 snapshot}; do one $name base $JDM entry; one $name new $JDM entry; done
if [ -z "$SKIP_OTHERS" ]; then
one deepmatch base $BDM Bun.deepMatch; one deepmatch new $BDM Bun.deepMatch
one containing base $DMT_BASE walker; one containing new $DMT_NEW walker
for name in fail-repro fail-10 fail-last fail-plain10; do
  one $name base $JDM verdict+rows; one $name new $TW verdict; one $name new $ROWS rows
  one $name base $HOST host-call; one $name new $HOST host-call
done
fi
