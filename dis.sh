#!/bin/bash
# dis.sh <binary> <mangled symbol> : prints the normalized disassembly of one function (no addresses, targets as symbol+offset or REL).
bin=$1; sym=$2
line=$(llvm-nm -S --defined-only "$bin" | awk -v s="$sym" '$4==s {print $1, $2}')
start=$((16#${line%% *})); size=$((16#${line##* }))
llvm-objdump -d --no-show-raw-insn --no-leading-addr --start-address=$start --stop-address=$((start+size)) "$bin" \
  | grep -vE "^$|file format|Disassembly of|^<" \
  | sed -E 's/^\s+//' \
  | sed -E "s/0x[0-9a-f]+ <([^>+]+)(\+0x[0-9a-f]+)?>/<\1\2>/g" \
  | sed -E "s/<${sym}\+0x[0-9a-f]+>/<SELF+off>/g" \
  | sed -E 's/# 0x[0-9a-f]+/# ADDR/g; s/\(%rip\)/(%rip)/g; s/-?0x[0-9a-f]+\(%rip\)/REL(%rip)/g'
