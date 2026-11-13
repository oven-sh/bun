#!/bin/sh
# usage: slope.sh <bin> <fd>  -> median instructions at N=200, 600, 1000 and slopes
bin=$1; fd=$2
med() { sort -n | sed -n 2p; }
for n in 200 600 1000; do
  v=$(for i in 1 2 3; do FD=$fd N=$n /tmp/m/icount $bin /tmp/probe-fd/paced.cjs 2>&1 >/dev/null | awk '/instructions:u/{print $2}'; done | med)
  eval "v$n=$v"
done
echo "$bin fd=$fd: N200=$v200 N600=$v600 N1000=$v1000 slope(200-600)=$(( (v600 - v200) / 400 )) slope(600-1000)=$(( (v1000 - v600) / 400 )) slope(200-1000)=$(( (v1000 - v200) / 800 ))"
