#!/bin/sh
# usage: sh emulate-lto.sh [/tmp/b4ec] > emulated-lto.txt
# The release link is ThinLTO: it inlines the per-token handlers into parse_prefix and parse_suffix. This runs the back end of that
# link on the ONE module of the crate (the bitcode in the library of build-release-rlib.py): every method of P made internal, the
# pipeline thinlto<O2>, then llc -O2 for nehalem. No other module is imported, so it is a proxy of the binary, close in shape
# (head: parse_prefix 15284 / 16344 bytes here, 14675 / 15804 in build/release/bun-profile). Then the same counts as static-codegen.sh.
S=${1:-/tmp/b4ec}
L=/usr/lib/llvm-23/bin
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$S/dis2"
for w in head proto; do
  mkdir -p "$S/bc/$w"
  if [ ! -f "$S/bc/$w/opt.o" ]; then
    (cd "$S/bc/$w" && $L/llvm-ar x "$S/$w/lto/"libbun_js_parser-*.rlib)
    bc=$(ls "$S/bc/$w"/*.rcgu.o)
    $L/llvm-nm --defined-only --no-sort "$bc" 2>/dev/null | awk '{print $3}' > "$S/bc/$w/defined.txt"
    $L/llvm-nm --defined-only --no-sort --demangle "$bc" 2>/dev/null | sed 's/^[0-9a-f-]* . //' | paste "$S/bc/$w/defined.txt" - | grep -v "::p::P<" | cut -f1 > "$S/bc/$w/keep.txt"
    nice $L/opt -passes='internalize,thinlto<O2>' --internalize-public-api-file="$S/bc/$w/keep.txt" "$bc" -o "$S/bc/$w/opt.bc"
    nice $L/llc -O2 -mcpu=nehalem --relocation-model=static --function-sections --frame-pointer=all -filetype=obj "$S/bc/$w/opt.bc" -o "$S/bc/$w/opt.o"
  fi
done
for fn in parse_prefix parse_suffix parse_expr_or_let_stmt parse_expr_common parse_stmt t_for; do
  for m in "false, false" "true, false" "false, true" "true, true"; do
    N="<bun_js_parser::p::P<$m>>::$fn"; k=$(echo "$m" | tr -d ' ,')
    python3 "$HERE/disfn.py" "$S/bc/head/opt.o" "$N" 2>/dev/null | sed 's/Lanon\.[0-9a-f.]*/Lanon/g' > "$S/dis2/h.$fn.$k.s"
    python3 "$HERE/disfn.py" "$S/bc/proto/opt.o" "$N" 2>/dev/null | sed 's/Lanon\.[0-9a-f.]*/Lanon/g' > "$S/dis2/p.$fn.$k.s"
    hl=$(grep -vc ':$' "$S/dis2/h.$fn.$k.s"); pl=$(grep -vc ':$' "$S/dis2/p.$fn.$k.s")
    hj=$(grep -cP '^\tj(?!mp)' "$S/dis2/h.$fn.$k.s"); pj=$(grep -cP '^\tj(?!mp)' "$S/dis2/p.$fn.$k.s")
    d=$(diff "$S/dis2/h.$fn.$k.s" "$S/dis2/p.$fn.$k.s" | grep -c '^[<>]')
    printf '%-24s P<%-12s>  instructions %5d -> %5d (%+d)  conditional jumps %4d -> %4d (%+d)  differing lines %d\n' "$fn" "$m" "$hl" "$pl" $((pl-hl)) "$hj" "$pj" $((pj-hj)) "$d"
  done
done
