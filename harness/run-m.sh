#!/bin/bash
cd /workspace/ee-perf-3/harness
A=/workspace/ee-perf-3/bin/bun-profile-base
B=/workspace/ee-perf-3/bin/bun-profile-m2
for tier in ftl llint base dfg; do
  out=../results-m/ab-hot-$tier
  if grep -q "^$tier " $out.txt 2>/dev/null; then continue; fi
  timeout 14400 /workspace/ee-perf-3/bin/bun-base ee-icount.mjs --a $A --b $B --cases hot --tiers $tier --reps 3 --jobs 5 --out $out.json > $out.txt 2> $out.err
  echo "tier $tier exit $?" >> ../results-m/log.txt
done
out=../results-m/ab-cold
timeout 7200 /workspace/ee-perf-3/bin/bun-base ee-icount.mjs --a $A --b $B --cases cold --reps 3 --jobs 5 --out $out.json > $out.txt 2> $out.err
echo "cold exit $?" >> ../results-m/log.txt
echo ALLDONE >> ../results-m/log.txt
