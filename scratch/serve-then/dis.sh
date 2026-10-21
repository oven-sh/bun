#!/bin/bash
# Usage: dis.sh <bin> <symbol-substring> [n]   -> disassembly of the n-th symbol (default 1) that contains the substring
BIN=$1; SYM=$2; N=${3:-1}
[ -f "$BIN.symsS" ] || nm -S -C "$BIN" > "$BIN.symsS" 2>/dev/null
LINE=$(grep -F "$SYM" "$BIN.symsS" | sed -n "${N}p")
[ -n "$LINE" ] || { echo "symbol not found: $SYM"; exit 1; }
ADDR=$(echo "$LINE" | cut -d' ' -f1); SIZE=$(echo "$LINE" | cut -d' ' -f2)
echo "# $LINE"
objdump -d --no-show-raw-insn -C --start-address=0x$ADDR --stop-address=$(printf '0x%x' $((0x$ADDR + 0x$SIZE))) "$BIN" | sed -n '/^ *[0-9a-f]*:/p'
