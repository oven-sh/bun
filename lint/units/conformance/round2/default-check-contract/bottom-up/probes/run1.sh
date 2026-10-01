#!/bin/bash
# Runs the test file of the scratch clone: installed bun (whole file), release build with --lint (whole file), debug build (three describes).
cd /tmp/dcx1a/scratch || exit 1
D=/workspace/wt/conformance/build/debug/bun-debug
R=/workspace/wt/parser/build/release/bun
L=/tmp/dcx1a/logs
echo "### lock acquired $(date -u +%T) load $(cut -d' ' -f1-3 /proc/loadavg)"
s=$(date +%s)
timeout 1200 bun test test/cli/lint/conformance.test.ts > $L/installed.log 2>&1; echo "installed bun, whole file: rc=$? secs=$(( $(date +%s) - s ))"
s=$(date +%s)
timeout 1200 $R test test/cli/lint/conformance.test.ts > $L/release.log 2>&1; echo "release with --lint, whole file: rc=$? secs=$(( $(date +%s) - s ))"
s=$(date +%s)
BUN_DEBUG_QUIET_LOGS=1 timeout 3000 $D test test/cli/lint/conformance.test.ts --timeout 180000 -t "default check|^run |expectations.json" > $L/debug-three.log 2>&1; echo "debug, three describes: rc=$? secs=$(( $(date +%s) - s ))"
echo "### finished $(date -u +%T)"
