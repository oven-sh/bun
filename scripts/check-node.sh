#!/bin/bash

i=0
j=0

export BUN_DEBUG_QUIET_LOGS=1
export NO_COLOR=1

for x in $(git ls-files test/js/node/test/parallel --exclude-standard --others | grep test-$1)
do
  i=$((i+1))
  echo ./$x
  if timeout 2 $PWD/build/debug/bun-debug ./$x
  then
    j=$((j+1))
    git add ./$x
  fi
  echo
  echo
done

echo $i tests tested
echo $j tests passed
