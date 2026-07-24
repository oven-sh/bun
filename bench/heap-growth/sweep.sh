#!/bin/bash
# Sweep driver. Writes NDJSON to $OUT (default results.ndjson).
# Each line: {"rep":N,"tags":{...},"result":{...}}
set -u
cd /workspace/heapgrowth
OUT="${OUT:-results.ndjson}"
REPS="${REPS:-3}"
BUN=/workspace/bun/build/release/bun
M=./measure.sh
MS=./measure-server.sh

run() { # <json-tags> <script> <args...>
  local tags="$1"; shift
  for rep in $(seq 1 "$REPS"); do
    local line
    line=$("$@")
    echo "{\"rep\":$rep,\"tags\":$tags,\"result\":$line}" | tee -a "$OUT"
  done
}

workload() { # <name>
  case "$1" in
    tsc)      $M tsc workloads/ts-large -- "$BUN" node_modules/.bin/tsc -p . ;;
    synth)    LIVE_MB=200 CHURN_MB=6000 $M synth workloads/synth -- "$BUN" alloc.js ;;
    express)  LIVE_MB=150 DURATION=15 $MS express workloads/servers -- "$BUN" app-express.js ;;
    fastify)  LIVE_MB=150 DURATION=15 $MS fastify workloads/servers -- "$BUN" app-fastify.js ;;
    elysia)   LIVE_MB=150 DURATION=15 $MS elysia  workloads/servers -- "$BUN" app-elysia.ts ;;
    nodehttp) LIVE_MB=150 DURATION=15 $MS nodehttp workloads/servers -- "$BUN" app-nodehttp.js ;;
    next)     (cd workloads/next-app && rm -rf .next) ; NEXT_TELEMETRY_DISABLED=1 $M next workloads/next-app -- "$BUN" --bun node_modules/.bin/next build --webpack ;;
  esac
}

: > "$OUT"

WL_MAIN="tsc synth express fastify"
WL_ALL="tsc synth express fastify elysia nodehttp next"

echo "=== Phase 1: baseline (Bun defaults: MI=2.0, SF=1.0) ===" >&2
for wl in $WL_ALL; do
  run "{\"phase\":\"baseline\",\"regime\":\"ge16_native\",\"wl\":\"$wl\"}" workload "$wl"
done

echo "=== Phase 2: >=16GB sweep heapGrowthMaxIncrease (steepness=1.0 Bun default) ===" >&2
export BUN_JSC_heapGrowthSteepnessFactor=1.0
for mi in 0.5 1.0 1.5 2.0 2.5 3.0; do
  export BUN_JSC_heapGrowthMaxIncrease=$mi
  for wl in $WL_MAIN; do
    run "{\"phase\":\"ge16\",\"knob\":\"maxIncrease\",\"val\":$mi,\"steep\":1.0,\"wl\":\"$wl\"}" workload "$wl"
  done
done
unset BUN_JSC_heapGrowthMaxIncrease BUN_JSC_heapGrowthSteepnessFactor

echo "=== Phase 2b: >=16GB sweep steepness (MI fixed at 2.0 Bun default) ===" >&2
export BUN_JSC_heapGrowthMaxIncrease=2.0
for sf in 0.5 1.0 2.0 4.0; do
  export BUN_JSC_heapGrowthSteepnessFactor=$sf
  for wl in tsc synth; do
    run "{\"phase\":\"ge16\",\"knob\":\"steepness\",\"val\":$sf,\"mi\":2.0,\"wl\":\"$wl\"}" workload "$wl"
  done
done
unset BUN_JSC_heapGrowthMaxIncrease BUN_JSC_heapGrowthSteepnessFactor

echo "=== Phase 3: <16GB (forceRAMSize=8GB) sweep smallHeapGrowthFactor ===" >&2
export BUN_JSC_forceRAMSize=8589934592
for gf in 1.3 1.5 1.75 2.0 2.5; do
  export BUN_JSC_smallHeapGrowthFactor=$gf
  for wl in $WL_MAIN; do
    run "{\"phase\":\"lt16\",\"ram\":\"8g\",\"knob\":\"small\",\"val\":$gf,\"wl\":\"$wl\"}" workload "$wl"
  done
done
unset BUN_JSC_smallHeapGrowthFactor BUN_JSC_forceRAMSize

echo "=== Phase 4: spot-check elysia/nodehttp/next at candidate values ===" >&2
for mi in 1.0 2.0; do
  export BUN_JSC_heapGrowthMaxIncrease=$mi
  for wl in elysia nodehttp next; do
    run "{\"phase\":\"spot\",\"regime\":\"ge16\",\"knob\":\"maxIncrease\",\"val\":$mi,\"wl\":\"$wl\"}" workload "$wl"
  done
  unset BUN_JSC_heapGrowthMaxIncrease
done
for gf in 1.5 2.0; do
  export BUN_JSC_forceRAMSize=8589934592 BUN_JSC_smallHeapGrowthFactor=$gf
  for wl in elysia nodehttp next; do
    run "{\"phase\":\"spot\",\"regime\":\"lt16\",\"knob\":\"small\",\"val\":$gf,\"wl\":\"$wl\"}" workload "$wl"
  done
  unset BUN_JSC_forceRAMSize BUN_JSC_smallHeapGrowthFactor
done

echo "=== done: $OUT ===" >&2
