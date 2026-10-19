#!/bin/bash
# usage: xcheck.sh <triple>; writes /tmp/h/x-<triple>.errors
cd /workspace/bun
T=$1
BUN_CODEGEN_DIR=/workspace/bun/build/debug/codegen cargo check --workspace --all-targets --keep-going --message-format=short --target $T > /tmp/h/x-$T.log 2>&1
grep -E "^(src|build)/[^ ]+: error" /tmp/h/x-$T.log | sort -u > /tmp/h/x-$T.errors
echo "$T errors: $(wc -l < /tmp/h/x-$T.errors) finished: $(grep -c Finished /tmp/h/x-$T.log)"
cut -c1-230 /tmp/h/x-$T.errors | head -${TOP:-40}
