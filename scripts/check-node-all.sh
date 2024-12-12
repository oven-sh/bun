#!/bin/bash

i=0
j=0

for x in $(find test/js/node/test/parallel -type f -name "test-$1*.js")
do
  i=$((i+1))
  echo ./$x
  if timeout 2 $PWD/build/debug/bun-debug ./$x
  then
    j=$((j+1))
  fi
  echo
done

echo $i tests tested
echo $j tests passed
