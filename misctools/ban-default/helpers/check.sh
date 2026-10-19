#!/bin/bash
# usage: check.sh [extra cargo args]; writes /tmp/h/errors.txt (unique error lines) and prints a summary
cd /workspace/bun
BUN_CODEGEN_DIR=/workspace/bun/build/debug/codegen cargo check --workspace --all-targets --keep-going --message-format=short "$@" > /tmp/h/last.log 2>&1
grep -E "^(src|build)/[^ ]+: error" /tmp/h/last.log | sort -u > /tmp/h/errors.txt
echo "errors: $(wc -l < /tmp/h/errors.txt)   failed crates: $(grep -E '^error: could not compile' /tmp/h/last.log | sed -E 's/ due to.*//' | sort -u | wc -l)   finished: $(grep -c Finished /tmp/h/last.log)"
sed -E 's/^([^:]+):.*/\1/' /tmp/h/errors.txt | sort | uniq -c | sort -rn | head -${TOP:-25}
