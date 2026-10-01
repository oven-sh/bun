#!/bin/bash
# Compares what the verifiers printed in two trees, after timings and the names of the trees are taken out.
# usage: compare_runs.sh <output directory of the first tree> <output directory of the second tree>
A=$1
B=$2
norm() {
  sed -E -e 's#[^ "]*/(orig|overlay)/#<tree>/#g' -e 's#[^ "]*/out-(orig|overlay)#<out>#g' \
    -e 's/\[[0-9.]+ ?m?s\]//g' -e 's/"?ms"?:? ?[0-9.]+//g' -e 's/seconds [0-9.]+/seconds N/g' -e 's/"msWrite":[0-9]+/"msWrite":N/g' \
    -e 's/[0-9.]+ ?ms\b/N ms/g' -e 's/[0-9.]+s\]/Ns]/g' -e 's/crosscheck-[a-z]+-[0-9]+\.jsonl/crosscheck.jsonl/g' \
    -e 's/bun test v[^ ]+ \([0-9a-f]+\)/bun test/' -e 's#lint-conformance[-a-zA-Z0-9_]*#lint-conformance#g' -e 's#bun-lint-probe-[A-Za-z0-9]+#bun-lint-probe#g' \
    -e 's#ccds-[a-z]+-[A-Za-z0-9]+#ccds#g' -e 's/[[:space:]]+$//' "$1"
}
same=0
differ=0
for f in $(ls "$A"/*.out | xargs -n1 basename); do
  code=$(tail -1 "$B/$f")
  # The tests of one file run side by side: the order of their lines is no difference.
  order=cat
  case "$f" in *.test.out) order=sort ;; esac
  if diff <(norm "$A/$f" | $order) <(norm "$B/$f" | $order) > /dev/null 2>&1; then
    same=$((same + 1))
    echo "same       ${f%.out}: $code"
  else
    differ=$((differ + 1))
    echo "DIFFERENT  ${f%.out}: $code"
  fi
done
echo "verifier runs: same output $same, different output $differ"
