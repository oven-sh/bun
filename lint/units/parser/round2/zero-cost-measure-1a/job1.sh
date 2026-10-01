#!/bin/sh
# one lock: link each variant (rlib replaced), cachegrind of it, and the grammar tests with its binary
S=/tmp/zc1a/seam
T=/workspace/notes/lint/units/parser/paren-expr-seam
export OUT=$S/link CACHE=$S/thinlto-cache
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
for v in "$@"; do
  python3 $T/relink.py $v $S/out/$v/libbun_js_parser-185fe25973f3a1f8.rlib full
  if [ -x $S/link/$v/bun-profile ]; then
    /workspace/notes/lint/tools/cgbench.sh $S/link/$v/bun-profile $S/cg $v 20 > $S/cg.$v.summary.txt 2>&1; echo "cgbench $v rc=$? $(date -u +%T)"
    ( cd /workspace/wt/parser && timeout 900 $S/link/$v/bun-profile test test/bundler/transpiler/typescript-grammar.test.ts test/bundler/transpiler/typescript-grammar-expressions.test.ts test/bundler/transpiler/typescript-grammar-statements.test.ts test/bundler/transpiler/typescript-grammar-decorator-metadata.test.ts test/bundler/transpiler/decorator-metadata.test.ts test/bundler/transpiler/transpiler.test.js test/bundler/esbuild/ts.test.ts --timeout 60000 > $S/tests.$v.log 2>&1; echo "tests $v rc=$? $(date -u +%T)" )
  fi
done
date -u +"done %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
