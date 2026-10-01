#!/bin/sh
# Makes the dumps that the measurements read: the lib closure of lib.es5.d.ts and of lib.esnext.full.d.ts,
# one JSON per file, with the dump script of ../../ts-dump-and-test-importer/top-down/probe and typescript 6.0.2.
set -e
D=${NTC_DUMPS:-/tmp/ntc/dumps}
P=/workspace/notes/lint/units/typecheck/ts-dump-and-test-importer/top-down/probe
mkdir -p /tmp/ntc/dump/node_modules $D/es5 $D/esnext
ln -sfn /workspace/bun/node_modules/typescript /tmp/ntc/dump/node_modules/typescript
cp $P/dump-ast.ts $P/measure.ts $P/libclosure.mjs /tmp/ntc/dump/
cd /tmp/ntc/dump
bun libclosure.mjs lib.es5.d.ts $D/es5.list
bun libclosure.mjs lib.esnext.full.d.ts $D/esnext.list
bun measure.ts $D/es5.list single $D/es5
bun measure.ts $D/esnext.list single $D/esnext
sed 's|.*/|'$D'/es5/|; s|$|.ast.json|' $D/es5.list > $D/es5.dumps
sed 's|.*/|'$D'/esnext/|; s|$|.ast.json|' $D/esnext.list > $D/esnext.dumps
echo $D/es5/lib.es5.d.ts.ast.json > $D/es5only.dumps
