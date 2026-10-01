#!/bin/sh
# Runs every surviving vector set and ESLint's own tests through the probe and ESLint. usage: sh run-all.sh [--show]
cd "$(dirname "$0")"
D="node oracle/diff.cjs"
C=../rules-comparisons/cases
B=../rules-expression-equality-bottomup/vectors
E=../rules-expression-equality/cases
echo "== vector sets of the earlier research"
$D no-unsafe-negation "$@" $C/final-no-unsafe-negation.txt $C/nun.txt $C/extra-nun.txt
$D no-compare-neg-zero "$@" $C/final-ncnz.txt $C/ncnz.txt
$D use-isnan "$@" $C/final-use-isnan.txt $C/isnan.txt $C/shadow.txt $C/chain.txt $C/dyn.txt $C/uni.txt $C/smoke.txt $C/naive.txt $C/html.txt $C/extra-pd.txt
$D valid-typeof "$@" $C/final-valid-typeof.txt $C/typeof.txt $C/shadow.txt $C/uni.txt $C/smoke.txt
$D no-duplicate-case "$@" $B/vectors-no-duplicate-case.json $E/dup-diff.json $E/dup-edge.json $E/dup-eslint-tests.json $E/dup-final.json $E/dup-final-module.json
$D no-self-assign "$@" $B/vectors-no-self-assign.json $E/self-edge.json $E/self-eslint-tests.json $E/self-static.json
echo "== ESLint's own tests, default options"
for r in no-debugger no-dupe-keys no-dupe-class-members no-duplicate-case no-empty-pattern no-compare-neg-zero use-isnan valid-typeof no-unsafe-negation no-sparse-arrays no-self-assign; do
  $D $r "$@" cases/upstream-$r.json
done
if ls cases/extra-*.json >/dev/null 2>&1; then
  echo "== cases written for this research"
  for f in cases/extra-*.json; do r=${f#cases/extra-}; r=${r%.json}; $D $r "$@" $f; done
fi
