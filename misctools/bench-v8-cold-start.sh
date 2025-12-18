#!/bin/bash
# V8 Cold Start Benchmark
# Usage: ./bench-v8-cold-start.sh [iterations]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUN_DIR="$(dirname "$SCRIPT_DIR")"
COLD_V8="$BUN_DIR/build/release/cold-v8-start"

if [[ ! -x "$COLD_V8" ]]; then
    echo "Building cold-v8-start..."
    cmake --build "$BUN_DIR/build/release" --target cold-v8-start >/dev/null 2>&1
fi

ITERATIONS=${1:-5}

echo "=== V8 Isolate Cold Start Benchmark ==="
echo ""

# Single cold start
echo "--- Single Cold Start (fresh process) ---"
for i in $(seq 1 $ITERATIONS); do
    "$COLD_V8" -e "write('')" 2>&1 | grep -v "^$"
    echo ""
done

# 100 Isolates benchmark
echo "--- 100 Isolates Benchmark ---"
for i in $(seq 1 3); do
    echo "Run $i:"
    "$COLD_V8" --benchmark-isolate 2>&1
    echo ""
done

# Memory usage
echo "--- Memory Usage (100 Isolates + Contexts) ---"
/usr/bin/time -l "$COLD_V8" --benchmark-isolate 2>&1 | grep -E "(Isolates|Contexts|maximum resident|peak memory)"
