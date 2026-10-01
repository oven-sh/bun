#!/bin/bash
# head: size probe (dev + release), then the Rust tests of the parser crate
cd /workspace/wt/parser || exit 9
echo "### size probe head $(date -u +%FT%TZ)"
/workspace/notes/lint/units/parser/measure/sizeprobe/run.sh /workspace/wt/parser head /workspace/wt/parser/build/debug/codegen /workspace/notes/lint/measure/parser/sizes
echo "### cargo test $(date -u +%FT%TZ)"
s=$(date +%s)
cargo test -p bun_js_parser --lib > /tmp/pbb1b/logs/07a-cargo-test-js_parser.log 2>&1
rc=$?
echo "cargo test rc=$rc $(( $(date +%s) - s ))s"
tail -6 /tmp/pbb1b/logs/07a-cargo-test-js_parser.log
exit $rc
