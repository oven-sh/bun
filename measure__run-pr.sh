#!/bin/bash
cd /workspace/bun
bun bd --version > /tmp/build-debug.log 2>&1 || { echo "debug build failed" > /tmp/run-pr.done; exit 1; }
cp build/debug/bun-debug /tmp/bun-pr-final5
bash /tmp/measure/symbols.sh /tmp/bun-pr-final5 /tmp/measure/symbols-final5.txt
bash /tmp/measure/counts-of.sh /tmp/bun-pr-final5 /tmp/measure/symbols-final5.txt /tmp/measure/final5-counts.txt
bun run build:release --version > /tmp/build-release.log 2>&1
echo "release exit=$?" > /tmp/run-pr.done
size build/release/bun > /tmp/measure/size-pr5.txt; ls -l build/release/bun >> /tmp/measure/size-pr5.txt
git -C /workspace/bun rev-parse HEAD >> /tmp/measure/size-pr5.txt
