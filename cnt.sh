#!/bin/bash
# usage: cnt.sh <bun-profile> <css> → instructions inside StyleSheet::minify, and the output size
BIN=$1; CSS=$2
ENTRY=$(nm -C "$BIN" | grep "StyleSheet<bun_css::css_parser::DefaultAtRule>>::minify$" | awk '{print $1}')
D=$(mktemp -d)
C=$(qemu-x86_64 -one-insn-per-tb -d exec,nochain -D /dev/stdout "$BIN" build $CSS --outdir $D/out 2>/dev/null | /tmp/insn/count $ENTRY 2>/dev/null | sort -n | tail -1)
echo "$C $(cat $D/out/*.css | wc -c) $(grep -o 'text-decoration' $D/out/*.css | wc -l)"
rm -rf $D
