#!/usr/bin/env bash
# usage: /workspace/tools/lk bash run-tests.sh <scratch clone with the corpus> <directory for the logs>
# Runs the candidate describe as a test file of the scratch clone: installed release build, debug build of the worktree,
# and the debug build with the leak check of CI. The scratch clone is made with ../../scratch.sh; the candidate is copied
# to test/cli/lint/repository-proto.test.ts of the clone.
set -u
scratch=$(cd -- "${1:?usage: run-tests.sh <scratch clone> <log directory>}" && pwd)
logs=${2:?usage: run-tests.sh <scratch clone> <log directory>}
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$logs"
cp "$here/repository-describe.candidate.ts" "$scratch/test/cli/lint/repository-proto.test.ts"
cd "$scratch" || exit 1
T=./test/cli/lint/repository-proto.test.ts
D=/workspace/wt/conformance/build/debug/bun-debug
leak="BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=/workspace/wt/conformance/test/leaksan.supp"
echo "start $(date -u +%H:%M:%S) load $(cut -d' ' -f1-3 /proc/loadavg)" > "$logs/times.txt"
s=$(date +%s%N); USE_SYSTEM_BUN=1 bun test $T > "$logs/release.log" 2>&1; echo "release exit $? $(( ($(date +%s%N) - s) / 1000000 )) ms" >> "$logs/times.txt"
s=$(date +%s%N); BUN_DEBUG_QUIET_LOGS=1 $D test $T > "$logs/debug.log" 2>&1; echo "debug exit $? $(( ($(date +%s%N) - s) / 1000000 )) ms" >> "$logs/times.txt"
s=$(date +%s%N); env BUN_DEBUG_QUIET_LOGS=1 $leak $D test $T > "$logs/debug-leak.log" 2>&1; echo "debug with the leak check exit $? $(( ($(date +%s%N) - s) / 1000000 )) ms" >> "$logs/times.txt"
echo "end $(date -u +%H:%M:%S) load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$logs/times.txt"
cat "$logs/times.txt"
grep -h '(pass)\|(fail)\| pass$\| fail$\|^Ran ' "$logs"/release.log "$logs"/debug.log "$logs"/debug-leak.log
