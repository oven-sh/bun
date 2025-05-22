#!/bin/sh

i=0
j=0
r=0
f=0

if [ -z "$1" ]
then
  echo "Usage: $0 <module-name>"
  exit 1
fi

case $1 in
  -h|--help)
    echo "Usage: $0 <module-name>"
    echo "Run all parallel tests for a single module in node's standard library"
    exit 0
    ;;
esac

export BUN_DEBUG_QUIET_LOGS=1
#clean regressions.txt and fails.txt
rm ./regressions.txt
rm  ./fails.txt

for x in $(find test/js/node/test/parallel -type f -name "test-$1*.js" | sort)
do
  i=$((i+1))
  echo ./$x
  if timeout 5 $PWD/build/debug/bun-debug ./$x
  then
    j=$((j+1))
    git add $x
  elif git ls-files --error-unmatch $x > /dev/null 2>&1; then
    echo ./$x >> ./regressions.txt
    r=$((r+1))  # Increment regression count
  else
    echo ./$x >> ./fails.txt
    f=$((f+1))  # Increment failure count
  fi
done

echo $i tests tested
echo $j tests passed
echo $r tests regressions
echo $f tests failed