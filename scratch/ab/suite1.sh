#!/bin/bash
# suite1.sh <build> <kind> <file>
build=$1; kind=$2; f=$3; bin=/tmp/ab/$build/bun
cd /workspace/bun
if [ "$kind" = vend ]; then
  out=$(timeout 180 $bin "$f" 2>&1); code=$?
  if [ $code -ne 0 ] && echo "$out" | grep -q "outside of the test runner"; then out=$(timeout 300 $bin test "./$f" 2>&1); code=$?; fi
else
  out=$(timeout 600 $bin test "./$f" 2>&1); code=$?
fi
[ $code -eq 0 ] && echo "PASS $f" || echo "FAIL($code) $f"
