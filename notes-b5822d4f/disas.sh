#!/bin/bash
# usage: disas.sh <base|pr> <exact demangled symbol>
bin=/workspace/bun/build/release-$1/bun-profile
line=$(nm -S -C $bin | grep -F " $2" | awk -v s="$2" '{ name=$0; sub(/^[0-9a-f]+ [0-9a-f]+ . /, "", name); if (name == s) print $1" "$2 }' | head -1)
start=0x${line%% *}; size=0x${line##* }
objdump -d --no-show-raw-insn -C --start-address=$start --stop-address=$((start + size)) $bin | grep -E "^\s+[0-9a-f]+:" | sed -E 's/^\s+[0-9a-f]+:\s+//' | sed -E 's/[0-9a-f]{6,} </</g; s/0x[0-9a-f]{5,}/ADDR/g; s/# [0-9a-f]+ /# /; s/\.llvm\.[0-9]+/.llvm.N/g'
