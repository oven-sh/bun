#!/bin/bash
# run-measure.sh <insns|calls> : prints one line per fixture and build.
mode=$1
export PATH=/usr/lib/llvm-23/bin:$PATH
cd /tmp/repro-9089/measure
JDM=JSC__JSValue__jestDeepMatch
BDM=_ZN3Bun20functionBunDeepMatchEPN3JSC14JSGlobalObjectEPNS0_9CallFrameE
for spec in pass3:$JDM pass10:$JDM plain3:$JDM plain10:$JDM matchers10:$JDM not3:$JDM snapshot:$JDM deepmatch:$BDM containing:DM fail-repro:$JDM fail-10:$JDM fail-last:$JDM; do
  name=${spec%%:*}; sym=${spec#*:}
  for b in base pr; do
    s=$sym
    if [ "$sym" = DM ]; then
      if [ $b = base ]; then s=_Z14Bun__deepMatchILb1EEbN3JSC7JSValueES1_PNS0_14JSGlobalObjectERNS0_10ThrowScopeERN3Bun14DeepMatchStateEb; else s=_Z14Bun__deepMatchILb1ELb0EEbN3JSC7JSValueES1_PNS0_14JSGlobalObjectERNS0_10ThrowScopeERN3Bun14DeepMatchStateEb; fi
    fi
    out=$(MEASURE_MODE=$mode MEASURE_SYMBOL=$s MEASURE_SKIP=100 MEASURE_RUNS=3 BUN_JSC_useConcurrentJIT=0 timeout 900 gdb -q -batch -x measure.py --args /tmp/repro-9089/bin/bun-profile-$b test ./$name.test.js 2>&1 | grep RESULT | sed 's/.*-> //')
    echo "$mode $name $b: ${out:-NO RESULT}"
  done
done
