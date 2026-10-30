#!/bin/bash
# usage: run-vendored.sh <bun binary> <result file> [jobs=6]
# Runs every vendored test-quic-*.mjs of node's suite with that binary, as the node test runner
# does (exit code 0 is a pass). Writes "<exit code> <file>" lines, sorted by file.
set -u
bin=${1:?bun binary}
out=${2:?result file}
jobs=${3:-6}
repo=${BUN_REPO:-/workspace/bun}
cd "$repo/test/js/node/test/parallel" || exit 1
export BUN_DEBUG_QUIET_LOGS=1
ls test-quic-*.mjs | xargs -P "$jobs" -I{} sh -c \
  'timeout 120 "$0" "{}" >/dev/null 2>&1; echo "$? {}"' "$bin" | sort -k2 >"$out"
echo "files: $(wc -l <"$out"), failed: $(grep -vc '^0 ' "$out")"
grep -v '^0 ' "$out"
