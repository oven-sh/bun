#!/bin/bash
# usage: ab.sh <rounds> <target: null|file|pipe> <script> <args...>   interleaved A/B on one core; prints min/median/max ns per write for each build
rounds=$1; target=$2; shift 2
A=/tmp/bins/ab/bun-mainjs; B=/tmp/bins/ab/bun-marker
run() { # $1 = binary
  case $target in
    null) BUN_JSC_useConcurrentJIT=0 taskset -c 5 "$1" "${@:2}" 2>&1 >/dev/null | tail -1 ;;
    file) BUN_JSC_useConcurrentJIT=0 taskset -c 5 "$1" "${@:2}" 2>&1 >/tmp/bench/out.bin | tail -1 ;;
    pipe) { BUN_JSC_useConcurrentJIT=0 taskset -c 5 "$1" "${@:2}" 2>/tmp/bench/err.txt | taskset -c 7 cat >/dev/null; }; tail -1 /tmp/bench/err.txt ;;
  esac
}
a=(); b=()
for i in $(seq 1 $rounds); do a+=("$(run $A "$@")"); b+=("$(run $B "$@")"); done
stats() { printf '%s\n' "$@" | sort -n | awk '{v[NR]=$1} END {printf "min %.1f  median %.1f  max %.1f  (spread %.1f%%)", v[1], v[int((NR+1)/2)], v[NR], (v[NR]-v[1])/v[1]*100}'; }
echo "  main: $(stats "${a[@]}")"
echo "  marker: $(stats "${b[@]}")"
