#!/bin/sh
# The probe of the research (the text of the research, not the file of the tree) over the inputs of deep.py: what a file that is
# nested too deeply keeps of this rule, and long chains of comparisons. usage: sh deep.sh <scratch dir>     PROBE names the probe
set -e
here=$(cd "$(dirname "$0")" && pwd)
probe=${PROBE:-/tmp/c3final/out/lintprobe}
mkdir -p "$1" && cd "$1"
python3 "$here/deep.py"
for f in vt-member.js vt-member-before.js vt-leftchain.js vt-or.js vt-nested.js; do
  echo "== $f"
  # The first two reports of each kind, then how many there are of it.
  ASAN_OPTIONS=detect_leaks=0 "$probe" "$f" | awk -F'\t' '{ if (NF >= 6) { k = $5 " " $6; c[k]++; if (c[k] <= 2) print } else print } END { for (k in c) if (c[k] > 2) print c[k] " x " k }'
done
