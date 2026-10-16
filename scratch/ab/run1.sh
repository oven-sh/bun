#!/bin/bash
# run1.sh <build> <shape> <tier> <mode> <rep>
build=$1; shape=$2; tier=$3; mode=$4; rep=$5
case "$shape" in
  assertFail) if [ $tier = llint ]; then warm=20; n=3; else warm=4000; n=10; fi ;;
  assertFailObject) if [ $tier = llint ]; then warm=20; n=2; else warm=4000; n=6; fi ;;
  assertPass) if [ $tier = llint ]; then warm=20; n=40; else warm=20000; n=200; fi ;;
  mixed) if [ $tier = llint ]; then warm=64; n=32; else warm=32000; n=64; fi ;;
  *) if [ $tier = llint ]; then warm=40; n=6; else warm=20000; n=40; fi ;;
esac
if [ $tier = llint ]; then envs="BUN_JSC_useJIT=0"; else envs="BUN_JSC_useConcurrentJIT=0 BUN_JSC_useFTLJIT=0"; fi
count=$(setarch x86_64 -R env $envs /tmp/ab/icstep /tmp/ab/$build/bun /tmp/ab/m3.cjs $shape $warm $n $mode 2>/dev/null | tail -1)
echo "$shape $mode $tier $build $rep $n $count"
