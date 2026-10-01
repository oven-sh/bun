#!/bin/sh
cd /workspace/wt/conformance || exit 97
echo "### queued: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
/workspace/tools/lk sh -c 'echo "### lock acquired: $(date -u +%Y-%m-%dT%H:%M:%SZ)"; s=$(date +%s); bun bd -j8 --version; rc=$?; echo "### finished: $(date -u +%Y-%m-%dT%H:%M:%SZ) rc=$rc run_secs=$(( $(date +%s) - s ))"; exit $rc'
echo "### outer rc=$?"
