#!/bin/bash
# usage: runtest.sh <repo> <tag> <n> [extra bun test args]
# Runs the conformance test file n times with the installed release bun, each run alone under the machine lock,
# and writes for each: the wait for the lock, the load average, the runner's own output, and real/user/sys of the run.
repo=$1; tag=$2; n=${3:-5}; shift 3
cd "$repo" || exit 1
for k in $(seq 1 "$n"); do
  out=/tmp/rtb1a/out/$tag-$k.log
  asked=$(date +%s)
  /workspace/tools/lk bash -c "echo lockwait \$(( \$(date +%s) - $asked )) s; echo loadavg \$(cat /proc/loadavg); TIMEFORMAT='TIME real %R user %U sys %S'; time USE_SYSTEM_BUN=1 bun test test/cli/lint/conformance.test.ts $*; echo exit \$?" > "$out" 2>&1
done
echo done > /tmp/rtb1a/out/$tag.done
