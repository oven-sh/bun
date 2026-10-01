#!/bin/sh
cd /tmp/conf-wb/tree || exit 97
echo "### queued: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
env -u LSAN_OPTIONS -u BUN_DESTRUCT_VM_ON_EXIT -u BUN_OPTIONS ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0 BUN_ENABLE_CRASH_REPORTING=0 /workspace/tools/lk sh -c 'echo "### lock acquired: $(date -u +%Y-%m-%dT%H:%M:%SZ) pressure: $(head -1 /sys/fs/cgroup/cpu.pressure)"; s=$(date +%s); bun conformance/sweep.ts --bin /workspace/wt/conformance/build/debug/bun-debug --jobs 4 --timeout 60000 --report /tmp/conf-wb/rep-es5.json conformance/parser/ecmascript5/ > /tmp/conf-wb/es5.out 2>&1; rc=$?; echo "### finished: $(date -u +%Y-%m-%dT%H:%M:%SZ) rc=$rc run_secs=$(( $(date +%s) - s )) pressure: $(head -1 /sys/fs/cgroup/cpu.pressure)"'
echo "### outer rc=$?"
