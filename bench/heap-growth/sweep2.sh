#!/bin/bash
# Re-sweep with minEdenToOldGenerationRatio knob.
set -u
cd /workspace/heapgrowth
OUT="${OUT:-results2.ndjson}"
REPS="${REPS:-3}"
BUN=/workspace/bun/build/release-local/bun
M=./measure.sh
MS=./measure-server.sh

run() {
  local tags="$1"; shift
  for rep in $(seq 1 "$REPS"); do
    local line; line=$("$@")
    echo "{\"rep\":$rep,\"tags\":$tags,\"result\":$line}" | tee -a "$OUT"
  done
}

workload() {
  case "$1" in
    tsc)      $M tsc workloads/ts-large -- "$BUN" node_modules/.bin/tsc -p . ;;
    synth)    LIVE_MB=200 CHURN_MB=6000 $M synth workloads/synth -- "$BUN" alloc.js ;;
    express)  LIVE_MB=150 DURATION=15 $MS express workloads/servers -- "$BUN" app-express.js ;;
    fastify)  LIVE_MB=150 DURATION=15 $MS fastify workloads/servers -- "$BUN" app-fastify.js ;;
  esac
}

: > "$OUT"

echo "=== A: >=16GB, ratio x MI ===" >&2
export BUN_JSC_heapGrowthSteepnessFactor=1.0
for ratio in 0.2 0.25 0.333333; do
  export BUN_JSC_minEdenToOldGenerationRatio=$ratio
  for mi in 0.3 0.5 0.75 1.0 2.0; do
    export BUN_JSC_heapGrowthMaxIncrease=$mi
    for wl in tsc synth express fastify; do
      run "{\"phase\":\"A\",\"ratio\":$ratio,\"mi\":$mi,\"wl\":\"$wl\"}" workload "$wl"
    done
  done
done
unset BUN_JSC_minEdenToOldGenerationRatio BUN_JSC_heapGrowthMaxIncrease BUN_JSC_heapGrowthSteepnessFactor

echo "=== B: <16GB (8GB), ratio x small ===" >&2
export BUN_JSC_forceRAMSize=8589934592
for ratio in 0.2 0.25 0.333333; do
  export BUN_JSC_minEdenToOldGenerationRatio=$ratio
  for sf in 1.3 1.5 1.75 2.0; do
    export BUN_JSC_smallHeapGrowthFactor=$sf
    for wl in tsc synth express fastify; do
      run "{\"phase\":\"B\",\"ratio\":$ratio,\"small\":$sf,\"wl\":\"$wl\"}" workload "$wl"
    done
  done
done
unset BUN_JSC_forceRAMSize BUN_JSC_minEdenToOldGenerationRatio BUN_JSC_smallHeapGrowthFactor

echo "=== done: $OUT ===" >&2
