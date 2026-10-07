#!/bin/bash
# usage: sweep.sh <harness-binary> [case-glob] [jobs]
# Runs every delivery plan for every case. Prints one line per plan that
# differs from the single-read reference, then totals.
H=$1; GLOB=${2:-*}; JOBS=${3:-8}
cd /tmp/la-harness/cases
plans=$(mktemp)
for f in $GLOB.tgz; do
  [ -f "$f" ] || continue
  size=$(stat -c %s "$f")
  step=1
  if [ "$size" -gt 20000 ]; then step=$(( size / 3000 + 1 )); fi
  opts=""
  case "$f" in mac_*|trunc_mac*) opts="mac-ext";; esac
  for mode in 0 1; do
    echo "LA_OPTS=$opts LA_STEP=$step timeout 900 $H $f split 1 0 $mode" >> "$plans"
    for k in 1 2 3 5 7 64 100 511 512 513 1000 4096 65536; do
      if [ "$size" -gt 300000 ] && [ "$k" -lt 64 ]; then continue; fi
      echo "LA_OPTS=$opts timeout 900 $H $f dribble $k $mode" >> "$plans"
    done
  done
done
total=$(wc -l < "$plans")
res=$(mktemp)
xargs -P "$JOBS" -I{} sh -c '{ out=$({} 2>&1 | tail -1); echo "{} => $out"; }' < "$plans" > "$res"
grep -v " bad=0 " "$res" | sed -e 's/LA_OPTS=[^ ]* //' -e 's/LA_STEP=[^ ]* //' -e 's/timeout 900 [^ ]* //' | sort
echo "plans=$total with_mismatch=$(grep -vc ' bad=0 ' "$res") msg_only_plans=$(grep ' bad=0 ' "$res" | grep -vc ' msg_only=0 ')"
rm -f "$plans" "$res"
