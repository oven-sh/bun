#!/bin/sh
# Rebuilds vectors/<rule>.json and DIFFERENCES.txt from every case list on disk. usage: sh make-vectors.sh [probe] [eslint dir]
# Needs the probe (probe/build.py) and ESLint at the pin with its dependencies (../rules-expression-equality-bottomup/prototype/setup.sh).
cd "$(dirname "$0")"
N=${NOTES:-/workspace/notes/lint/units/cli}
P=${1:-/tmp/c3final/out/lintprobe}
L=${2:-/tmp/cmp-probe/eslint-pin}
R=$N/rule-support-unification-bottomup/cases
U=$N/c3-rule-support-unification/cases
C=$N/rules-comparisons/cases
B=$N/rules-expression-equality-bottomup/vectors
E=$N/rules-expression-equality/cases
D="node oracle/diff.cjs"
O="--probe $P --eslint $L --show"
mkdir -p vectors
{
$D no-debugger $O --out vectors/no-debugger.json $R/upstream-no-debugger.json $R/extra-no-debugger.json $U/no-debugger.own.json
$D no-sparse-arrays $O --out vectors/no-sparse-arrays.json $R/upstream-no-sparse-arrays.json $R/extra-no-sparse-arrays.json $U/no-sparse-arrays.own.json
$D no-empty-pattern $O --out vectors/no-empty-pattern.json $R/upstream-no-empty-pattern.json $R/extra-no-empty-pattern.json $U/no-empty-pattern.own.json
$D no-dupe-keys $O --out vectors/no-dupe-keys.json $R/upstream-no-dupe-keys.json $R/extra-no-dupe-keys.json $U/no-dupe-keys.dupe-probe-extra.json $U/no-dupe-keys.dupe-probe-extra2.json $U/no-dupe-keys.rdm-keys-own.json $U/no-dupe-keys.rdm-show.json
$D no-dupe-class-members $O --out vectors/no-dupe-class-members.json $R/upstream-no-dupe-class-members.json $R/extra-no-dupe-class-members.json $U/no-dupe-class-members.dupe-probe-extra.json $U/no-dupe-class-members.dupe-probe-extra2.json $U/no-dupe-class-members.rdm-class-mod.json $U/no-dupe-class-members.rdm-class-own.json $U/no-dupe-class-members.rdm-show.json
$D no-compare-neg-zero $O --out vectors/no-compare-neg-zero.json $R/upstream-no-compare-neg-zero.json $C/final-ncnz.txt $C/ncnz.txt
$D use-isnan $O --out vectors/use-isnan.json $R/upstream-use-isnan.json $C/final-use-isnan.txt $C/isnan.txt $C/shadow.txt $C/chain.txt $C/dyn.txt $C/uni.txt $C/smoke.txt $C/naive.txt $C/html.txt $C/extra-pd.txt
$D valid-typeof $O --out vectors/valid-typeof.json $R/upstream-valid-typeof.json $C/final-valid-typeof.txt $C/typeof.txt $C/shadow.txt $C/uni.txt $C/smoke.txt
$D no-unsafe-negation $O --out vectors/no-unsafe-negation.json $R/upstream-no-unsafe-negation.json $C/final-no-unsafe-negation.txt $C/nun.txt $C/extra-nun.txt
$D no-duplicate-case $O --out vectors/no-duplicate-case.json $R/upstream-no-duplicate-case.json $R/extra-no-duplicate-case.json $B/vectors-no-duplicate-case.json $E/dup-diff.json $E/dup-edge.json $E/dup-eslint-tests.json $E/dup-final.json $E/dup-final-module.json cases/own-no-duplicate-case.json
$D no-self-assign $O --out vectors/no-self-assign.json $R/upstream-no-self-assign.json $R/extra-no-self-assign.json $B/vectors-no-self-assign.json $E/self-edge.json $E/self-eslint-tests.json $E/self-static.json cases/own-no-self-assign.json
} > DIFFERENCES.txt 2>&1
grep -E '^[a-z-]+: [0-9]+ cases' DIFFERENCES.txt
# Marks the vectors whose code is a case of ESLint's own test of the rule: `"eslintTest": true`.
for f in vectors/*.json; do r=${f#vectors/}; r=${r%.json}; node oracle/extract.cjs $r --all > /tmp/c3final-all-$r.json && node oracle/mark-origin.cjs $f /tmp/c3final-all-$r.json; done
