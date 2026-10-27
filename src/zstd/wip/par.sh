#!/bin/bash
# par.sh <cmd> <first seed> <procs> <iters>: runs the harness in parallel, prints failures.
cmd=$1; first=$2; procs=$3; iters=$4
mkdir -p /root/zstd-ref/logs
for i in $(seq 0 $((procs-1))); do
  seed=$((first+i))
  ( /root/zstd-ref/harness/target/release/zstd_harness $cmd $seed $iters > /root/zstd-ref/logs/$cmd-$seed.log 2>&1 || echo "FAIL $cmd seed $seed" ) &
done
wait
grep -l "panicked\|Sanitizer\|Aborted" /root/zstd-ref/logs/$cmd-*.log 2>/dev/null | head
echo "par done: $cmd $first+$procs x $iters"
