#!/bin/bash
# Run all memory64/table64 tests across all wasm tier configurations
set -u
cd "$(dirname "$0")"
JSC=./WebKitBuild/JSCOnly/Release/bin/jsc
[ -n "${JSC_BIN:-}" ] && JSC="$JSC_BIN"

declare -A CONFIGS
CONFIGS["default"]=""
CONFIGS["ipint-only"]="--useBBQJIT=0 --useOMGJIT=0"
CONFIGS["ipint-nosimd"]="--useBBQJIT=0 --useOMGJIT=0 --useWasmIPIntSIMD=0"
CONFIGS["bbq-only"]="--useOMGJIT=0 --useWasmIPInt=0"
CONFIGS["bbq-nofast"]="--useOMGJIT=0 --useWasmIPInt=0 --useWasmFastMemory=0"
CONFIGS["omg"]="--useWasmIPInt=0 --thresholdForOMGOptimizeAfterWarmUp=0 --thresholdForOMGOptimizeSoon=0"
CONFIGS["nofastmem"]="--useWasmFastMemory=0"
CONFIGS["ipint-nofastmem"]="--useBBQJIT=0 --useOMGJIT=0 --useWasmFastMemory=0"
CONFIGS["nojit"]="--useJIT=0"

TESTS=(
  JSTests/wasm/stress/memory64-atomic-notify-out-of-bounds.js
  JSTests/wasm/stress/memory64-atomic-wait-out-of-bounds.js
  JSTests/wasm/stress/memory64-atomics.js
  JSTests/wasm/stress/memory64-bulk-memory.js
  JSTests/wasm/stress/memory64-grow-and-size.js
  JSTests/wasm/stress/memory64-load-and-store.js
  JSTests/wasm/stress/memory64-overflow.js
  JSTests/wasm/stress/memory64-write-to-address-over-4-gigs.js
  JSTests/wasm/stress/table64-bulk.js
  JSTests/wasm/stress/table64-call-indirect.js
  JSTests/wasm/stress/table64-get-and-set.js
  JSTests/wasm/stress/table64-grow-and-size.js
  JSTests/wasm/stress/table64-initial-truncation.js
  JSTests/wasm/stress/table64-overflow.js
)

FAILURES=0
for cfg in "${!CONFIGS[@]}"; do
  opts="${CONFIGS[$cfg]}"
  for t in "${TESTS[@]}"; do
    rel="${t#JSTests/wasm/}"
    out=$(cd JSTests/wasm && timeout 120 ../../$JSC --useDollarVM=1 $opts -m "$rel" 2>&1)
    rc=$?
    if [ $rc -ne 0 ] || [ -n "$out" ]; then
      echo "FAIL [$cfg] $t (rc=$rc)"
      echo "$out" | head -10 | sed 's/^/  /'
      FAILURES=$((FAILURES+1))
    fi
  done
done
echo ""
echo "Total failures: $FAILURES"
exit $FAILURES
