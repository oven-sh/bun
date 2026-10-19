#!/bin/bash
# usage: pcheck.sh <crate...>; quick check of some crates only
cd /workspace/bun
args=""; for c in "$@"; do args="$args -p $c"; done
BUN_CODEGEN_DIR=/workspace/bun/build/debug/codegen cargo check $args --all-targets --keep-going --message-format=short > /tmp/h/p.log 2>&1
grep -E "^(src|build)/[^ ]+: error" /tmp/h/p.log | sort -u > /tmp/h/p.errors
echo "errors: $(wc -l < /tmp/h/p.errors) finished: $(grep -c Finished /tmp/h/p.log)"
cut -c1-${W:-330} /tmp/h/p.errors | head -${TOP:-60}
