#!/bin/bash
# Release builds of the head and of main (same build directory, same toolchain), binaries kept aside.
cd /workspace/bun
OUT=/tmp/h2repro
HEAD_SHA=$(git rev-parse --short=10 HEAD)
echo "head $HEAD_SHA $(date)" > $OUT/final/measure.log
if [ -n "$(git status --porcelain -- src packages)" ]; then echo "dirty tree" >> $OUT/final/measure.log; exit 1; fi
bun scripts/build.ts --profile=release --buildDir=build/rel-h2 > $OUT/final/rel-head.log 2>&1
echo "head build exit $? $(date)" >> $OUT/final/measure.log
rm -rf $OUT/rel-head && mkdir -p $OUT/rel-head && cp build/rel-h2/bun build/rel-h2/bun-profile $OUT/rel-head/
git checkout --no-overlay origin/main -- src/ packages/
echo "main src: $(git status --porcelain -- src packages | wc -l) files differ from HEAD" >> $OUT/final/measure.log
bun scripts/build.ts --profile=release --buildDir=build/rel-h2 > $OUT/final/rel-main.log 2>&1
echo "main build exit $? $(date)" >> $OUT/final/measure.log
rm -rf $OUT/rel-main && mkdir -p $OUT/rel-main && cp build/rel-h2/bun build/rel-h2/bun-profile $OUT/rel-main/
git checkout --no-overlay HEAD -- src/ packages/
echo "restored: $(git status --porcelain | wc -l) dirty entries" >> $OUT/final/measure.log
for b in rel-main rel-head; do
  echo "== $b" >> $OUT/final/measure.log
  stat -c '%s bytes %n' $OUT/$b/bun $OUT/$b/bun-profile >> $OUT/final/measure.log
  size -A $OUT/$b/bun | grep -E "^\.(text|rodata|data|bun_builtins|data\.rel\.ro|eh_frame)\s" >> $OUT/final/measure.log
done
echo DONE >> $OUT/final/measure.log
