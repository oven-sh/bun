#!/bin/bash

# @file leaks.sh
# @summary build + run bun with `leaks`. All args are forwarded to `bun-debug`.
#
# @description
# This script builds bun, signs it with debug entitlements, and runs it with
# `leaks` After running, a log file describing any found leaks gets saved to
# `logs/`
#
# This script requires `leaks` (from xcode cli tools) and only works on MacOS.

set -e -o pipefail

BUN="bun-debug"
DEBUG_BUN="build/debug/${BUN}"

# at least one argument is required
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <file_to_run> [bun args]"
  echo "       $0 test <file_to_run> [bun args]"
  exit 1
fi

bun run build

echo "Signing ${BUN} binary..."
codesign --entitlements $(realpath entitlements.debug.plist) --force --timestamp --sign - -vvvv --deep --strict ${DEBUG_BUN}

export BUN_JSC_logJITCodeForPerf=1
export BUN_JSC_collectExtraSamplingProfilerData=1
export BUN_JSC_sampleCCode=1
export BUN_JSC_alwaysGeneratePCToCodeOriginMap=1
export BUN_GARBAGE_COLLECTOR_LEVEL=2
# MiMalloc options. https://microsoft.github.io/mimalloc/environment.html
export MIMALLOC_SHOW_ERRORS=1


commit=$(git rev-parse --short HEAD)
logfile="./logs/${BUN}-leaks-$1-${commit}.log"
mkdir -p "logs" || true
# forwards all arguments to bun-debug
echo "Running ${file_to_run}, logs will be saved to ${logfile}..."

# must be set just before `leaks` runs, since these affect all executables.
# see: https://developer.apple.com/library/archive/documentation/Performance/Conceptual/ManagingMemory/Articles/MallocDebug.html
export MallocStackLogging=1
export MallocScribble=1          # fill free'd memory with 0x55
export MallocPreScribble=1       # fill alloc'd memory with 0xAA
export MallocGuardEdges=1        # add guard pages before and after large allocations
export MallocCheckHeapStart=1000 # validate heap after n malloc() calls
export MallocCheckHeapEach=100   # validate heap after every n malloc() calls

leaks -atExit -- "./${DEBUG_BUN}" ${@:1} | tee "${logfile}"
