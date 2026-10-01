#!/bin/sh
# one lock: the A1 harness head vs f1b (parity of a parse without lint), and the unit tests of the crate (the lint side) on the patched copies v0 (control), f1b, f3b, vold3
S=/tmp/zcm-td/seam; B=/workspace/notes/lint/measure/parser; G=/tmp/zcm-td/gd; R=$G/runs
M=/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down
mkdir -p $S/testbin /tmp/zcm-td/testcwd $M/harness
date -u +"lock acquired %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
cd $G
for c in testrows targeted small; do
  [ -s $R/f1b.$c.jsonl.gz ] || { $S/link/f1b/bun-profile harness.mjs corpus.$c.json $R/f1b.$c.jsonl.gz --jobs=4 > $R/f1b.$c.log 2>&1; echo "harness f1b $c rc=$? $(tail -1 $R/f1b.$c.log)"; }
  bun diff.mjs $R/head.$c.jsonl.gz $R/f1b.$c.jsonl.gz --causes=causes.empty.mjs --out=$R/diff.head-f1b.$c.jsonl --show=6 > $R/diff.head-f1b.$c.txt 2>&1; echo "diff head f1b $c rc=$?: $(sed -n 3p $R/diff.head-f1b.$c.txt)"
  head -80 $R/diff.head-f1b.$c.txt > $M/harness/diff.head-f1b.$c.head80.txt
done
for tag in v0 f1b f3b vold3; do
  s=$(date +%s)
  python3 $M/testbin.py $tag link 8 > $S/testbin/$tag.build.log 2>&1
  echo "testbin $tag: $(head -1 $S/testbin/$tag.build.log) ($(( $(date +%s) - s )) s wall)"
  if [ -x $S/testbin/$tag/bun_js_parser ]; then
    ( cd /tmp/zcm-td/testcwd && $S/testbin/$tag/bun_js_parser > $S/testbin/$tag.test.log 2>&1; echo "tests $tag rc=$? $(grep '^test result' $S/testbin/$tag.test.log)" )
    grep -E '^test .* FAILED$' $S/testbin/$tag.test.log | head -60
  else
    grep -E '^error' $S/testbin/$tag.build.log | head -20
  fi
done
date -u +"done %FT%TZ load $(cut -d' ' -f1-3 /proc/loadavg)"
