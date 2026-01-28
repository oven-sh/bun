#!/bin/bash
# Benchmark script for cycle detection optimization

echo "=== Module Loader Benchmark ==="
echo "Testing with 500 files, deep re-export chains"
echo ""

# Run the benchmark 3 times and take the best result
BEST_TIME=999999

for i in 1 2 3; do
    echo "Run $i/3..."
    START=$(date +%s%3N)
    ./build/debug/bun-debug ./bench/module-loader/import.mjs > /tmp/bench-output.txt 2>&1
    EXIT_CODE=$?
    END=$(date +%s%3N)

    if [ $EXIT_CODE -eq 0 ]; then
        ELAPSED=$((END - START))
        echo "  Time: ${ELAPSED}ms"

        if [ $ELAPSED -lt $BEST_TIME ]; then
            BEST_TIME=$ELAPSED
        fi
    else
        echo "  Failed with exit code $EXIT_CODE"
        cat /tmp/bench-output.txt
    fi
done

echo ""
echo "Best time: ${BEST_TIME}ms"
echo ""
grep "Loaded" /tmp/bench-output.txt
