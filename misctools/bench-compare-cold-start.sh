#!/bin/bash
# Compare JSC vs V8 Cold Start Performance
# Usage: ./bench-compare-cold-start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUN_DIR="$(dirname "$SCRIPT_DIR")"
COLD_JSC="$BUN_DIR/build/release/cold-jsc-start"
COLD_V8="$BUN_DIR/build/release/cold-v8-start"

# Build if needed
if [[ ! -x "$COLD_JSC" ]] || [[ ! -x "$COLD_V8" ]]; then
    echo "Building benchmark tools..."
    cmake --build "$BUN_DIR/build/release" --target cold-jsc-start cold-v8-start >/dev/null 2>&1
fi

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         JSC vs V8 Cold Start Benchmark Comparison           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Single cold start comparison
echo "┌────────────────────────────────────────────────────────────────┐"
echo "│ Single Cold Start (average of 5 runs, fresh process each)     │"
echo "└────────────────────────────────────────────────────────────────┘"
echo ""

echo "JavaScriptCore:"
jsc_total=0
for i in $(seq 1 5); do
    output=$("$COLD_JSC" -e "write('')" 2>&1)
    init=$(echo "$output" | grep "Initialize" | awk '{print $3}')
    vm=$(echo "$output" | grep "VM::create" | awk '{print $3}')
    global=$(echo "$output" | grep "GlobalObject" | awk '{print $3}')
    total=$(echo "$init + $vm + $global" | bc)
    jsc_total=$(echo "$jsc_total + $total" | bc)
    printf "  Run %d: Init=%.2fms VM=%.2fms GlobalObject=%.2fms Total=%.2fms\n" $i $init $vm $global $total
done
jsc_avg=$(echo "scale=3; $jsc_total / 5" | bc)
echo ""

echo "V8:"
v8_total=0
for i in $(seq 1 5); do
    output=$("$COLD_V8" -e "write('')" 2>&1)
    init=$(echo "$output" | grep "Initialize" | awk '{print $3}')
    isolate=$(echo "$output" | grep "Isolate::New" | awk '{print $3}')
    context=$(echo "$output" | grep "Context::New" | awk '{print $3}')
    total=$(echo "$init + $isolate + $context" | bc)
    v8_total=$(echo "$v8_total + $total" | bc)
    printf "  Run %d: Init=%.2fms Isolate=%.2fms Context=%.2fms Total=%.2fms\n" $i $init $isolate $context $total
done
v8_avg=$(echo "scale=3; $v8_total / 5" | bc)
echo ""

speedup=$(echo "scale=2; $v8_avg / $jsc_avg" | bc)
printf "Average: JSC=%.2fms  V8=%.2fms  (JSC is %.1fx faster)\n" $jsc_avg $v8_avg $speedup
echo ""

# 100 VMs/Isolates benchmark
echo "┌────────────────────────────────────────────────────────────────┐"
echo "│ 100 VMs/Isolates + GlobalObjects/Contexts (best of 3 runs)    │"
echo "└────────────────────────────────────────────────────────────────┘"
echo ""

echo "JavaScriptCore (100 VMs + GlobalObjects):"
jsc_best=999999
for i in $(seq 1 3); do
    output=$("$COLD_JSC" --benchmark-vm 2>&1)
    # Format: "Created 100 VMs + GlobalObjects in 22.015750 ms (0.220158 ms per VM+GlobalObject)"
    time=$(echo "$output" | grep "GlobalObjects" | sed 's/.*(\([0-9.]*\) ms.*/\1/')
    if (( $(echo "$time < $jsc_best" | bc -l) )); then
        jsc_best=$time
    fi
    echo "  Run $i: $time ms per VM+GlobalObject"
done
echo ""

echo "V8 (100 Isolates + Contexts):"
v8_best=999999
for i in $(seq 1 3); do
    output=$("$COLD_V8" --benchmark-isolate 2>&1)
    # Format: "Created 100 Isolates + Contexts in 24.277375 ms (0.242774 ms per Isolate+Context)"
    time=$(echo "$output" | grep "Isolate+Context" | sed 's/.*(\([0-9.]*\) ms.*/\1/')
    if (( $(echo "$time < $v8_best" | bc -l) )); then
        v8_best=$time
    fi
    echo "  Run $i: $time ms per Isolate+Context"
done
echo ""

speedup=$(echo "scale=2; $v8_best / $jsc_best" | bc)
printf "Best: JSC=%.3fms/vm  V8=%.3fms/isolate  (JSC is %.1fx faster)\n" $jsc_best $v8_best $speedup
echo ""

# Memory comparison
echo "┌────────────────────────────────────────────────────────────────┐"
echo "│ Memory Usage (100 VMs/Isolates + GlobalObjects/Contexts)      │"
echo "└────────────────────────────────────────────────────────────────┘"
echo ""

echo "JavaScriptCore:"
jsc_mem=$(/usr/bin/time -l "$COLD_JSC" --benchmark-vm 2>&1 | grep "maximum resident" | awk '{print $1}')
jsc_mem_mb=$(echo "scale=1; $jsc_mem / 1048576" | bc)
echo "  Maximum RSS: ${jsc_mem_mb} MB"

echo ""
echo "V8:"
v8_mem=$(/usr/bin/time -l "$COLD_V8" --benchmark-isolate 2>&1 | grep "maximum resident" | awk '{print $1}')
v8_mem_mb=$(echo "scale=1; $v8_mem / 1048576" | bc)
echo "  Maximum RSS: ${v8_mem_mb} MB"

echo ""
mem_ratio=$(echo "scale=2; $v8_mem / $jsc_mem" | bc)
printf "Memory: JSC=%.1fMB  V8=%.1fMB  (V8 uses %.1fx more memory)\n" $jsc_mem_mb $v8_mem_mb $mem_ratio
echo ""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                         Summary                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
printf "  Single cold start:     JSC is %.1fx faster\n" $(echo "scale=1; $v8_avg / $jsc_avg" | bc)
printf "  100 VM/Isolate batch:  JSC is %.1fx faster\n" $(echo "scale=1; $v8_best / $jsc_best" | bc)
printf "  Memory per instance:   V8 uses %.1fx more memory\n" $mem_ratio
