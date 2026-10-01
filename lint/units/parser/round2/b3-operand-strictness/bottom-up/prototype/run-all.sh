#!/bin/sh
# One run under the lock: builds the scratch copy with the prototype, then every comparison of this directory.
# usage: /workspace/tools/lk sh run-all.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE/.."
sh prototype/build-scratch.sh /workspace/wt/parser /tmp/b3/scratch prototype
[ -x /tmp/b3/plain/out/bun_js_parser ] || sh prototype/build-scratch.sh /workspace/wt/parser /tmp/b3/plain plain
/tmp/b3/scratch/out/bun_js_parser 2>&1 | tail -2
node prototype/compare.cjs /tmp/b3/scratch/out/bun_js_parser table.txt > prototype/table.compare.txt
node prototype/compare.cjs /tmp/b3/scratch/out/bun_js_parser in1.txt in2.txt in3.txt in4.txt in5.txt in6.txt > prototype/rows.compare.txt
node prototype/compare.cjs /tmp/b3/scratch/out/bun_js_parser /workspace/notes/lint/units/parser/round2/expression-operand-rejections/bottom-up/inputs.txt > prototype/prior.compare.txt
mkdir -p /tmp/b3/fuzz
for l in ts js tsx; do node prototype/fuzz.cjs /tmp/b3/plain/out/bun_js_parser /tmp/b3/scratch/out/bun_js_parser $l > prototype/fuzz.$l.txt; head -1 prototype/fuzz.$l.txt; done
node prototype/corpus-lint.cjs /workspace/wt/parser /tmp/b3/plain/out/bun_js_parser /tmp/b3/scratch/out/bun_js_parser | tail -3
