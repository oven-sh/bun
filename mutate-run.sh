#!/bin/bash
# usage: run.sh <mutant>...   prints the tests that fail for each mutant (release build, 3 test files)
cd /workspace/bun
for m in "$@"; do
  python3 /tmp/mut2/mutate.py "$m" >/dev/null || { echo "[$m] could not build mutant"; continue; }
  out=$(timeout 300 /tmp/mut2/bun-$m test test/js/node/process/process-stdio-write-callback.test.ts test/js/node/child_process/child-process-stdio.test.js test/js/node/tty.test.ts 2>&1)
  fails=$(echo "$out" | grep -E "^\(fail\)" | sed -E 's/^\(fail\) //; s/ \[[0-9.]+ms\]$//; s/the write callback contract > //; s/ > reports as Node does//; s/process.stdout and process.stderr write callbacks > //' | sort -u)
  passes=$(echo "$out" | grep -E "^ *[0-9]+ pass" | awk '{print $1}')
  echo "[$m] pass=$passes fail=$(echo "$fails" | grep -c .)"
  echo "$fails" | sed 's/^/     - /' | grep -v '^     - $' | head -${MAXLINES:-12}
  rm -f /tmp/mut2/bun-$m
done
