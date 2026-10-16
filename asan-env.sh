#!/bin/sh
# usage: asan-env.sh <cmd...>   runs cmd with the environment of the CI ASAN lane (scripts/runner.node.ts)
export BUN_FEATURE_FLAG_NO_ORPHANS=1 BUN_JSC_validateExceptionChecks=1 BUN_JSC_dumpSimulatedThrows=1 BUN_DESTRUCT_VM_ON_EXIT=1
export ASAN_OPTIONS="allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1"
export LSAN_OPTIONS="malloc_context_size=30:print_suppressions=0:suppressions=/workspace/bun/test/leaksan.supp"
export BUN_DEBUG_QUIET_LOGS=1
exec "$@"
