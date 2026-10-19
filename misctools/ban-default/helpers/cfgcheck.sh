#!/bin/bash
# usage: cfgcheck.sh ; cargo check on the host with the build's custom cfgs on; writes /tmp/h/cfg.errors
cd /workspace/bun
export CARGO_INCREMENTAL=0
RUSTFLAGS="--cfg bun_asan --cfg bun_debug --cfg socket_fault_injection --cfg bun_disallow_code_generation_from_strings --cfg bun_sema_mimalloc" BUN_CODEGEN_DIR=/workspace/bun/build/debug/codegen cargo check --workspace --all-targets --keep-going --message-format=short --target-dir /workspace/bun/target/cfgcheck "$@" > /tmp/h/cfg.log 2>&1
grep -E "^(src|build)/[^ ]+: error" /tmp/h/cfg.log | sort -u > /tmp/h/cfg.errors
echo "cfg errors: $(wc -l < /tmp/h/cfg.errors) finished: $(grep -c Finished /tmp/h/cfg.log)"
cut -c1-230 /tmp/h/cfg.errors | head -${TOP:-40}
