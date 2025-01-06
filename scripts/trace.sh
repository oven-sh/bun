#!/bin/bash

# @file trace.sh
# @summary build + run bun with Instruments. All args are forwarded to `bun-debug`.
#
# @description
# This script builds bun, signs it with debug entitlements, and runs it with an
# Allocations template. After running, a `.trace` folder will be created. Open
# it with `open foo.trace` to view it in Instruments.
#
# This script requires xcode command line tools to be installed and only works
# on MacOS.

set -e -o pipefail

BUN="bun-debug"
DEBUG_BUN="build/debug/${BUN}"

file_to_run=$1
if [[ -z $file_to_run ]]; then
  echo "Usage: $0 <file_to_run> [bun args]"
  echo "       $0 test <file_to_run> [bun args]"
  exit 1
fi

bun run build

echo "Signing bun binary..."
codesign --entitlements $(realpath entitlements.debug.plist) --force --timestamp --sign - -vvvv --deep --strict ${DEBUG_BUN}

export BUN_JSC_logJITCodeForPerf=1
export BUN_JSC_collectExtraSamplingProfilerData=1
export BUN_JSC_sampleCCode=1
export BUN_JSC_alwaysGeneratePCToCodeOriginMap=1

echo "Tracing ${file_to_run}..."
xcrun xctrace record --template "Allocations" -output . --launch -- "./${DEBUG_BUN}" $file_to_run
# perf record -k 1 --sample-cpu -e cycles:u -j any --call-graph dwarf,16384 -F 499 -p (pgrep -f "${BUN}")

# DEBUGINFOD_URLS="" perf inject --jit --input perf.data --output=perf.jit.data -v
