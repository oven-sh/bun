#!/bin/bash
# Lists the files of the test project of the scratch clone with tsc, as test/tsconfig.json is and with the corpus excluded.
cd /tmp/rh1a/repo || exit 1
echo "got the lock $(date -u +%H:%M:%S), loadavg $(cat /proc/loadavg)"
cat > test/tsconfig.excl.json <<'JSON'
{
  "extends": "./tsconfig.json",
  "exclude": [
    "fixtures",
    "__snapshots__",
    "./snapshots",
    "./js/deno",
    "./node.js",
    "regression/issue/14477/*-mismatch.tsx",
    "integration/bun-types/fixture/ts7.1",
    "cli/lint/conformance/corpus"
  ]
}
JSON
for p in tsconfig tsconfig.excl; do
  ( time ./node_modules/.bin/tsc -p test/$p.json --listFilesOnly --incremental false --composite false > /tmp/rh1a/tsc/list-$p.txt 2> /tmp/rh1a/tsc/list-$p.err ) 2>&1 | grep real
  echo "test/$p.json: exit ${PIPESTATUS[0]}, $(wc -l < /tmp/rh1a/tsc/list-$p.txt) lines, $(grep -c '/test/cli/lint/conformance/corpus/' /tmp/rh1a/tsc/list-$p.txt) of the corpus, $(grep -c '/test/cli/lint/conformance/' /tmp/rh1a/tsc/list-$p.txt) below conformance/"
done
rm -f test/tsconfig.excl.json
echo "done $(date -u +%H:%M:%S)"
