#!/bin/sh
# The Rust tests of the parser crate at HEAD, then the list of their names.
out=/workspace/notes/lint/measure/parser/baseline
cd /workspace/wt/parser || exit 9
s=$(date +%s)
cargo test -p bun_js_parser --lib > "$out/cargo-test-a.log" 2>&1; rc=$?
echo "### cargo test -p bun_js_parser --lib rc=$rc secs=$(( $(date +%s) - s )) HEAD=$(git rev-parse --short=10 HEAD)" >> "$out/cargo-test-a.log"
cargo test -p bun_js_parser --lib -- --list > "$out/cargo-test-list-a.txt" 2>&1
echo "### list rc=$?" >> "$out/cargo-test-list-a.txt"
tail -5 "$out/cargo-test-a.log"
exit $rc
