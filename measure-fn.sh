#!/bin/bash
# usage: measure-fn.sh <bun-profile> <declaration> <symbol-regex>  → instructions per declaration inside the function
BIN=$1; DECL=$2; SYM=$3
ENTRY=$(nm -C "$BIN" | grep -E "$SYM" | head -1 | awk '{print $1}')
D=$(mktemp -d)
for n in 5000 10000; do
  python3 /tmp/insn/gen.py "$DECL" $n $D/s$n.css
  qemu-x86_64 -one-insn-per-tb -d exec,nochain -D /dev/stdout "$BIN" build $D/s$n.css --outdir $D/out$n 2>/dev/null | /tmp/insn/count $ENTRY 2>/dev/null | sort -n | tail -1 > $D/c$n
done
A=$(cat $D/c5000); B=$(cat $D/c10000)
python3 -c "print('%s\t%s\t%s\t%.1f' % ('$DECL', $A, $B, ($B-$A)/5000))"
rm -rf $D
