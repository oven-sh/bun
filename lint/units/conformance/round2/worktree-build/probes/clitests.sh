#!/bin/sh
cd /workspace/wt/conformance || exit 97
echo "### queued: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
/workspace/tools/lk sh -c 'echo "### lock acquired: $(date -u +%Y-%m-%dT%H:%M:%SZ)"; s=$(date +%s); for f in test/cli/lint/diagnostics.test.ts test/cli/lint/rules.test.ts test/cli/lint/lint.test.ts; do echo "=== $f"; bun bd test $f --timeout 180000 2>&1 | tail -60; echo "=== rc=$? secs=$(( $(date +%s) - s ))"; done; echo "### finished: $(date -u +%Y-%m-%dT%H:%M:%SZ) run_secs=$(( $(date +%s) - s ))"'
echo "### outer rc=$?"
