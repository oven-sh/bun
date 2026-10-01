#!/bin/sh
cd /tmp/conf-wb/tree || exit 97
echo "### queued: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
env -u ASAN_OPTIONS -u LSAN_OPTIONS -u BUN_DESTRUCT_VM_ON_EXIT -u BUN_OPTIONS BUN_ENABLE_CRASH_REPORTING=0 /workspace/tools/lk sh -c 'echo "### lock acquired: $(date -u +%Y-%m-%dT%H:%M:%SZ) pressure: $(head -1 /sys/fs/cgroup/cpu.pressure)"; s=$(date +%s); bun conformance/sweep.ts --bin /tmp/conf-wb/bun-release-be1ebe529 --jobs 4 --timeout 60000 --report /tmp/conf-wb/rep-full-release.json > /tmp/conf-wb/full-release.out 2>&1; rc=$?; echo "### finished: $(date -u +%Y-%m-%dT%H:%M:%SZ) rc=$rc run_secs=$(( $(date +%s) - s )) pressure: $(head -1 /sys/fs/cgroup/cpu.pressure)"'
echo "### outer rc=$?"
