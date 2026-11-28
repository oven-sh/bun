#!/bin/sh
# usage: tools/objdump.sh <binary or object> [options of llvm-objdump]     The code, with all extensions of its architecture, without local labels and data.
BIN=$(ls -d "$(rustc --print sysroot)"/lib/rustlib/*/bin | head -1); f=$1; shift
case $($BIN/llvm-objdump -f "$f" | grep 'file format') in
  *powerpc*) cpu="--mcpu=pwr11 -mllvm -ppc-asm-full-reg-names";;
  *s390*) cpu=--mcpu=z17;;
  *loongarch*) cpu=--mattr=+lasx,+frecipe;;
  *riscv*) cpu=--mattr=+rva23u64,+zvbc,+zvkn,+zvkg,+zvks,+zvfh,+zbc;;
  *littlearm*) cpu=--mcpu=cortex-a710;;
  *) cpu=--mattr=+all;;
esac
# On big-endian POWER, the name of a function is that of a descriptor, which has the address of the code.
if $BIN/llvm-objdump -h "$f" | grep -q ' \.opd '; then
  t=$(mktemp -d); trap 'rm -r $t' EXIT
  $BIN/llvm-objcopy -O binary -j .opd "$f" $t/opd
  $BIN/llvm-nm --defined-only "$f" | python3 -c '
import sys
opd, text, data = int(sys.argv[1], 16), int(sys.argv[2], 16), open(sys.argv[3], "rb").read()
for at, kind, name in (it.split() for it in sys.stdin):
    at = int(at, 16) - opd
    if 0 <= at < len(data) and (to := int.from_bytes(data[at:at + 8])) >= text: print(f"--add-symbol={name}=.text:{to - text},function,global")
' $($BIN/llvm-objdump -h "$f" | awk '$2 == ".text" { text = $4 } $2 == ".opd" { opd = $4 } END { print opd, text }') $t/opd > $t/symbols
  $BIN/llvm-objcopy @$t/symbols "$f" $t/named; f=$t/named
fi
# For IBM Z, the disassembler doesn't name what is called.
{ [ "$cpu" != --mcpu=z17 ] || $BIN/llvm-nm -C --defined-only "$f" | sed -n -E 's/^0*([0-9a-f]+) [tTwW] /= 0x\1 /p'
  $BIN/llvm-objdump -d -C --no-show-raw-insn $([ -n "${ADDRESSES:-}" ] || echo --no-leading-addr) $cpu "$@" "$f" 2>/dev/null; } |
  awk '$1 == "=" { name[$2] = substr($0, length($2) + 4); next } /^([0-9a-f]+ )?<(\.L|\$)|^ *[0-9a-f]+:.*\.(word|short|byte)/ { next } $NF in name && $1 ~ /^(brasl|jg)/ { $0 = $0 " <" name[$NF] ">" } 1'
