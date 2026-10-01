#!/bin/sh
# Rebuilds vectors/vectors-<rule>.json and DIFFERENCES.txt from every case list. usage: sh make-vectors.sh
cd "$(dirname "$0")"
C=../rules-comparisons/cases
B=../rules-expression-equality-bottomup/vectors
E=../rules-expression-equality/cases
D="node oracle/diff.cjs"
{
$D no-debugger --show --out vectors/vectors-no-debugger.json cases/upstream-no-debugger.json cases/extra-no-debugger.json
$D no-sparse-arrays --show --out vectors/vectors-no-sparse-arrays.json cases/upstream-no-sparse-arrays.json cases/extra-no-sparse-arrays.json
$D no-empty-pattern --show --out vectors/vectors-no-empty-pattern.json cases/upstream-no-empty-pattern.json cases/extra-no-empty-pattern.json
$D no-dupe-keys --show --out vectors/vectors-no-dupe-keys.json cases/upstream-no-dupe-keys.json cases/extra-no-dupe-keys.json
$D no-dupe-class-members --show --out vectors/vectors-no-dupe-class-members.json cases/upstream-no-dupe-class-members.json cases/extra-no-dupe-class-members.json
$D no-compare-neg-zero --show --out vectors/vectors-no-compare-neg-zero.json cases/upstream-no-compare-neg-zero.json $C/final-ncnz.txt $C/ncnz.txt
$D use-isnan --show --out vectors/vectors-use-isnan.json cases/upstream-use-isnan.json $C/final-use-isnan.txt $C/isnan.txt $C/shadow.txt $C/chain.txt $C/dyn.txt $C/uni.txt $C/smoke.txt $C/naive.txt $C/html.txt $C/extra-pd.txt
$D valid-typeof --show --out vectors/vectors-valid-typeof.json cases/upstream-valid-typeof.json $C/final-valid-typeof.txt $C/typeof.txt $C/shadow.txt $C/uni.txt $C/smoke.txt
$D no-unsafe-negation --show --out vectors/vectors-no-unsafe-negation.json cases/upstream-no-unsafe-negation.json $C/final-no-unsafe-negation.txt $C/nun.txt $C/extra-nun.txt
$D no-duplicate-case --show --out vectors/vectors-no-duplicate-case.json cases/upstream-no-duplicate-case.json cases/extra-no-duplicate-case.json $B/vectors-no-duplicate-case.json $E/dup-diff.json $E/dup-edge.json $E/dup-eslint-tests.json $E/dup-final.json $E/dup-final-module.json
$D no-self-assign --show --out vectors/vectors-no-self-assign.json cases/upstream-no-self-assign.json cases/extra-no-self-assign.json $B/vectors-no-self-assign.json $E/self-edge.json $E/self-eslint-tests.json $E/self-static.json
} > DIFFERENCES.txt 2>&1
grep -E '^[a-z-]+: [0-9]+ cases' DIFFERENCES.txt
# Marks the vectors whose code is a case of ESLint's own test of the rule: `"eslintTest": true`.
for f in vectors/vectors-*.json; do r=${f#vectors/vectors-}; r=${r%.json}; node oracle/extract.cjs $r --all > /tmp/rsu-all-$r.json && node oracle/mark-origin.cjs $f /tmp/rsu-all-$r.json; done
