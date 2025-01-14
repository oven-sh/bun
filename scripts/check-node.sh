#!/bin/sh

# How to use this script:
# 1. Pick a module from node's standard library (e.g. 'assert', 'fs')
# 2. Copy over relevant tests from node's parallel test suite into test/js/node/test/parallel
# 3. Run this script, e.g. `./scripts/check-node.sh fs`
# 4. Tests that passed get staged for commit

i=0
j=0

if [ -z "$1" ]
then
  echo "Usage: $0 <module-name>"
  exit 1
fi

case $1 in
  -h|--help)
    echo "Usage: $0 <module-name>"
    echo "Run all unstaged parallel tests for a single module in node's standard library"
    exit 0
    ;;
esac

export BUN_DEBUG_QUIET_LOGS=1

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
done

echo $i tests tested
echo $j tests passed
