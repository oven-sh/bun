#!/bin/sh
# usage: hyper.sh <runs> <cmd...>  -> prints min and median wall ms
n=$1; shift
for i in $(seq 1 $n); do s=$(date +%s%N); "$@" >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e - s) / 10000 )); done | sort -n | awk '{a[NR]=$1} END {printf "min %.2f ms  median %.2f ms\n", a[1]/100, a[int((NR+1)/2)]/100}'
