#!/bin/bash
# usage: icount.sh <binary> <relation> <kind>  -> user instructions per call (slope between two counts)
BIN=$1; REL=$2; KIND=$3
N1=2500000; N2=5000000
c() { BUN_JSC_useConcurrentJIT=0 BUN_DEBUG_QUIET_LOGS=1 /tmp/rec/m/icount "$BIN" /tmp/rec/m/bench.js "$REL" "$KIND" "$1" 2>&1 >/dev/null | awk '/ICOUNT/ {print $2}'; }
A=$(c $N1); B=$(c $N2)
echo "$REL $KIND $(( (B - A) / (N2 - N1) ))"
