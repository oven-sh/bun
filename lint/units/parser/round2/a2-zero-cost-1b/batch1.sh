#!/bin/sh
# one lock: the two combined variants (all, allnolint): link, counts in both modes, and the grammar tests with the binary of `all`
S=/tmp/a2zc/seam; B=/workspace/notes/lint/measure/parser; O=$S/cg
T=/workspace/notes/lint/units/parser/paren-expr-seam; M=/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down
export OUT=$S/link CACHE=$S/thinlto-cache
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
if [ ! -d $CACHE ]; then for c in /tmp/zcm-td/seam/thinlto-cache /tmp/zc1a/seam/thinlto-cache; do if [ -d $c ]; then cp -r $c $CACHE; echo "cache seeded from $c ($(ls $CACHE | wc -l) files)"; break; fi; done; fi
for v in all allnolint; do
  python3 $T/relink.py $v $S/out/$v/libbun_js_parser-185fe25973f3a1f8.rlib full
  if [ -x $S/link/$v/bun-profile ]; then
    /workspace/notes/lint/tools/cgbench.sh $S/link/$v/bun-profile $O $v 20 > $O/$v.summary.txt 2>&1; echo "cg $v rc=$? $(date -u +%T)"
    $M/cgbench-raw.sh $S/link/$v/bun-profile $O raw$v 20 > $O/raw$v.summary.txt 2>&1; echo "raw $v rc=$? $(date -u +%T)"
  fi
done
if [ -x $S/link/all/bun-profile ]; then
  ( cd /workspace/wt/parser && CI=true GITHUB_ACTIONS= timeout 900 $S/link/all/bun-profile test test/bundler/transpiler/typescript-grammar.test.ts test/bundler/transpiler/typescript-grammar-expressions.test.ts test/bundler/transpiler/typescript-grammar-statements.test.ts test/bundler/transpiler/typescript-grammar-decorator-metadata.test.ts test/bundler/transpiler/decorator-metadata.test.ts test/bundler/transpiler/transpiler.test.js test/bundler/esbuild/ts.test.ts --timeout 60000 > $S/tests.all.log 2>&1; echo "tests all rc=$? $(date -u +%T)" )
fi
date -u +"done %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
