#!/bin/sh
# The Rust tests of bun_ast at HEAD with plain cargo: does the test binary link, and how many tests run.
out=/workspace/notes/lint/measure/parser/baseline
cd /workspace/wt/parser || exit 9
s=$(date +%s)
cargo test -p bun_ast --lib > "$out/cargo-test-bun_ast-a.log" 2>&1; rc=$?
echo "### cargo test -p bun_ast --lib rc=$rc secs=$(( $(date +%s) - s )) HEAD=$(git rev-parse --short=10 HEAD)" >> "$out/cargo-test-bun_ast-a.log"
tail -5 "$out/cargo-test-bun_ast-a.log"
exit $rc
