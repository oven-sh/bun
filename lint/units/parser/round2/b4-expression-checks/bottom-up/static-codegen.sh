#!/bin/sh
# usage: sh static-codegen.sh [/tmp/b4ec] > static-codegen.txt
# For each function that the prototype touches, in the two objects of build-release-obj.py (head, proto): the count of instructions and of
# conditional jumps of the whole function (cold blocks too), and how many lines of the disassembly differ. disfn.py prints one function.
S=${1:-/tmp/b4ec}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$S/dis"
for fn in pfx_t_void pfx_t_plus pfx_t_tilde pfx_t_exclamation pfx_t_typeof pfx_t_delete pfx_t_minus pfx_t_identifier pfx_t_super pfx_t_new parse_prefix parse_suffix sfx_t_dot sfx_t_question_dot sfx_t_less_than sfx_t_less_than_less_than sfx_t_open_bracket sfx_t_open_paren parse_expr_or_let_stmt parse_expr_common t_for; do
  for m in "false, false" "true, false" "false, true" "true, true"; do
    N="<bun_js_parser::p::P<$m>>::$fn"; k=$(echo "$m" | tr -d ' ,')
    python3 "$HERE/disfn.py" "$S/head/rel/bun_js_parser.o" "$N" > "$S/dis/h.$fn.$k.s" 2>/dev/null
    python3 "$HERE/disfn.py" "$S/proto/rel/bun_js_parser.o" "$N" > "$S/dis/p.$fn.$k.s" 2>/dev/null
    hl=$(grep -vc ':$' "$S/dis/h.$fn.$k.s"); pl=$(grep -vc ':$' "$S/dis/p.$fn.$k.s")
    hj=$(grep -cP '^\tj(?!mp)' "$S/dis/h.$fn.$k.s"); pj=$(grep -cP '^\tj(?!mp)' "$S/dis/p.$fn.$k.s")
    d=$(sed 's/Lanon\.[0-9a-f.]*/Lanon/g' "$S/dis/h.$fn.$k.s" | diff - "$S/dis/p.$fn.$k.s.n" 2>/dev/null | grep -c '^[<>]')
    sed 's/Lanon\.[0-9a-f.]*/Lanon/g' "$S/dis/h.$fn.$k.s" > "$S/dis/h.$fn.$k.s.n"; sed 's/Lanon\.[0-9a-f.]*/Lanon/g' "$S/dis/p.$fn.$k.s" > "$S/dis/p.$fn.$k.s.n"
    d=$(diff "$S/dis/h.$fn.$k.s.n" "$S/dis/p.$fn.$k.s.n" | grep -c '^[<>]')
    printf '%-28s P<%-12s>  instructions %5d -> %5d (%+d)  conditional jumps %4d -> %4d (%+d)  differing lines %d\n' "$fn" "$m" "$hl" "$pl" $((pl-hl)) "$hj" "$pj" $((pj-hj)) "$d"
  done
done
