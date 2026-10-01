#!/bin/sh
# From the output of `go test -v` of TestSubmodule: the subtests with PASS or SKIP, and the name and reason of every skip, both in byte order.
# usage: sh log_lists.sh <test.log> <out directory>      (pin.ts --reference-log reads the log itself; this is the same rule in awk)
set -e
LOG=$1
OUT=$2
mkdir -p "$OUT"
grep -E -- '^    --- (PASS|SKIP): TestSubmodule/' "$LOG" | sed -E 's/^    --- (PASS|SKIP): TestSubmodule\/(.*) \([0-9.]+s\)$/\1\t\2/' | LC_ALL=C sort > "$OUT/reference-subtests.tsv"
awk '
/^=== (NAME|CONT|RUN) +TestSubmodule\// { name = $0; sub(/^=== (NAME|CONT|RUN) +TestSubmodule\//, "", name); next }
/^=== / { name = "?"; next }
/^    compiler_runner\.go:[0-9]+: / { if (index(name, "/") == 0) { r = $0; sub(/^    compiler_runner\.go:[0-9]+: /, "", r); print name "\t" r }; next }
' "$LOG" | LC_ALL=C sort > "$OUT/reference-skips.tsv"
echo "subtests $(wc -l < "$OUT/reference-subtests.tsv") sha256 $(sha256sum < "$OUT/reference-subtests.tsv" | cut -c1-64)"
echo "skips    $(wc -l < "$OUT/reference-skips.tsv") sha256 $(sha256sum < "$OUT/reference-skips.tsv" | cut -c1-64)"
cut -f2 "$OUT/reference-skips.tsv" | sed -E 's/^(unsupported (baseUrl|outFile)) .*/\1/' | sort | uniq -c | sort -rn
