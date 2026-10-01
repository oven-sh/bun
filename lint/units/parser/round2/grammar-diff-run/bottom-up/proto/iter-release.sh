#!/bin/sh
# The prototype as a release binary: compile the scratch copy of src/js_parser with the rustc command of the release
# build, link bun-profile again with that rlib (ThinLTO cache of an earlier relink of the same build), then the A1 run
# on both corpora with it. usage: /workspace/tools/lk sh /tmp/gdr1a/proto/iter-release.sh <tag>
TAG=$1
P=/tmp/gdr1a/proto
R=/tmp/gdr1a/runs
cd "$P" || exit 9
date -u +"lock acquired %FT%TZ"
OUT=$P/out-release python3 tools/run_release.py "$TAG" "$P/root" > "$P/compile-release.$TAG.log" 2>&1
rc=$?
tail -c 3000 "$P/compile-release.$TAG.log"
[ $rc -eq 0 ] || { echo "compile failed rc=$rc"; exit 1; }
rlib=$(ls "$P"/out-release/"$TAG"/libbun_js_parser-*.rlib | head -1)
OUT=$P/link-release CACHE=/tmp/a3-seam/thinlto-cache python3 tools/relink_release.py "$TAG" "$rlib" full > "$P/link-release.$TAG.log" 2>&1
rc=$?
tail -3 "$P/link-release.$TAG.log"
[ $rc -eq 0 ] || { echo "link failed rc=$rc"; exit 2; }
BIN=$P/link-release/$TAG/bun-profile
"$BIN" --revision
cd /tmp/gdr1a/gd || exit 9
for c in targeted small; do
  rm -f "$R/$TAG.$c.jsonl.gz"
  "$BIN" harness.mjs "corpus.$c.json" "$R/$TAG.$c.jsonl.gz" --jobs=4 > "$R/$TAG.$c.log" 2>&1
  echo "harness $c rc=$?"; tail -1 "$R/$TAG.$c.log"
  bun diff.a1.mjs "$R/base.$c.jsonl.gz" "$R/$TAG.$c.jsonl.gz" "--oracle=$R/oracle.$c.jsonl.gz" --causes=causes.a1.mjs "--out=$R/diff.a1.$TAG.$c.jsonl" --show=1 > "$R/diff.a1.$TAG.$c.txt" 2>&1
  echo "diff $c rc=$?"; head -3 "$R/diff.a1.$TAG.$c.txt"; tail -1 "$R/diff.a1.$TAG.$c.txt"
done
date -u +"done %FT%TZ"
