#!/bin/bash
# Runs the test/aot files that use toMatchObject on the new release build; reruns the ones that fail on the base build.
cd /workspace/bun
: > /tmp/aot-9089/aot-results.txt
while read -r f; do
  out=$(timeout 600 /tmp/repro-9089/bin/bun-new test "$f" 2>&1); code=$?
  sum=$(echo "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ *[0-9]+ (pass|fail|skip|todo)" | tr '\n' ' ')
  line="new exit=$code $f :: $sum"
  if [ $code -ne 0 ]; then
    outb=$(timeout 600 /tmp/repro-9089/bin/bun-base test "$f" 2>&1); codeb=$?
    sumb=$(echo "$outb" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ *[0-9]+ (pass|fail|skip|todo)" | tr '\n' ' ')
    line="$line || base exit=$codeb :: $sumb"
  fi
  echo "$line" >> /tmp/aot-9089/aot-results.txt
done < /tmp/aot-9089/tmo-files.txt
echo DONE >> /tmp/aot-9089/aot-results.txt
