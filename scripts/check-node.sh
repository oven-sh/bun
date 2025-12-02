#!/usr/bin/env bash

# How to use this script:
# 1. Pick a module from node's standard library (e.g. 'assert', 'fs')
# 2. Copy over relevant tests from node's parallel test suite into test/js/node/test/parallel
# 3. Run this script, e.g. `./scripts/check-node.sh fs`
# 4. Tests that passed get staged for commit

i=0
j=0
k=0

export BUN_DEBUG_QUIET_LOGS=1
export BUN_JSC_validateExceptionChecks=1
export BUN_JSC_dumpSimulatedThrows=1
export BUN_JSC_unexpectedExceptionStackTraceLimit=20

trap 'echo "Interrupted by user"; exit 130' INT

fails=()

for x in $(git ls-files test/js/{node,bun}/test/{parallel,sequential} --exclude-standard | grep test-$1)
do
  i=$((i+1))
  echo ./$x
  if timeout 5 $PWD/build/release/bun-profile ./$x
  then
    echo $?
    j=$((j+1))
    git add $x
  else
    echo $?
    k=$((k+1))
    fails[${#fails[@]}]="$x"
  fi
done

echo $i tests tested
echo $j tests passed
echo $k tests failed

echo
echo fails:
for x in "${fails[@]}"
do
  echo -- $x
done
