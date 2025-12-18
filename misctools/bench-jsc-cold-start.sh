#!/bin/bash
# JSC Cold Start Benchmark
# Usage: ./bench-jsc-cold-start.sh [iterations]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUN_DIR="$(dirname "$SCRIPT_DIR")"
COLD_JSC="$BUN_DIR/build/release/cold-jsc-start"

if [[ ! -x "$COLD_JSC" ]]; then
    echo "Building cold-jsc-start..."
    cmake --build "$BUN_DIR/build/release" --target cold-jsc-start >/dev/null 2>&1
fi

ITERATIONS=${1:-5}

echo "=== JavaScriptCore Cold Start Benchmark ==="
echo ""

# Single cold start
echo "--- Single Cold Start (fresh process) ---"
for i in $(seq 1 $ITERATIONS); do
    "$COLD_JSC" -e "write('')" 2>&1 | grep -v "^$"
    echo ""
done

# 100 VMs benchmark
echo "--- 100 VMs Benchmark ---"
for i in $(seq 1 3); do
    echo "Run $i:"
    "$COLD_JSC" --benchmark-vm 2>&1
    echo ""
done

# Memory usage
echo "--- Memory Usage (100 VMs + GlobalObjects) ---"
/usr/bin/time -l "$COLD_JSC" --benchmark-vm 2>&1 | grep -E "(VMs|GlobalObjects|maximum resident|peak memory)"
