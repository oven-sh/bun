#!/bin/sh
# Runs the root-skipped archive tests as an unprivileged user with the debug build.
cd /workspace/bun
export HOME=/tmp/nobody-home TMPDIR=/tmp BUN_DEBUG_QUIET_LOGS=1 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 BUN_INSTALL_CACHE_DIR=/tmp/nobody-home/cache
exec ./build/debug/bun-debug test test/js/bun/archive.test.ts -t "$1"
