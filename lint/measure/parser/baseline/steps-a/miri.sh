#!/bin/sh
# The tests of bun_ast under Miri at HEAD: the only way they run, since the test binary does not link with plain cargo.
out=/workspace/notes/lint/measure/parser/baseline
cd /workspace/wt/parser || exit 9
s=$(date +%s)
bun run rust:miri -p bun_ast > "$out/miri-bun_ast-a.log" 2>&1; rc=$?
echo "### bun run rust:miri -p bun_ast rc=$rc secs=$(( $(date +%s) - s )) HEAD=$(git rev-parse --short=10 HEAD)" >> "$out/miri-bun_ast-a.log"
tail -5 "$out/miri-bun_ast-a.log"
exit $rc
