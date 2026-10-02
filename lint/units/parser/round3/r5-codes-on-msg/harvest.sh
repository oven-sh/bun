#!/bin/sh
# The native object of the bun_js_parser module as the ThinLTO link compiles it, for each variant.
export OUT=/tmp/r5codes/link CACHE=/tmp/r5codes/thinlto-cache HARVEST=1
for v in "$@"; do
  python3 /workspace/notes/lint/units/parser/paren-expr-seam/relink.py $v /tmp/r5codes/out/$v/libbun_js_parser-185fe25973f3a1f8.rlib
done
