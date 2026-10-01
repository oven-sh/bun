#!/bin/sh
# check, clippy and fmt of the two crates of the parser unit at HEAD, default targets and all targets
out=/workspace/notes/lint/measure/parser/baseline
cd /workspace/wt/parser || exit 9
all=0
run() { name="$1"; shift; s=$(date +%s); "$@" > "$out/$name-a.log" 2>&1; rc=$?; echo "### $* rc=$rc secs=$(( $(date +%s) - s )) HEAD=$(git rev-parse --short=10 HEAD)" >> "$out/$name-a.log"; [ $rc -ne 0 ] && all=1; echo "$name rc=$rc"; }
run check cargo check -p bun_ast -p bun_js_parser --message-format=short
run check-all-targets cargo check -p bun_ast -p bun_js_parser --all-targets --message-format=short
run clippy cargo clippy -p bun_ast -p bun_js_parser --no-deps --keep-going
run clippy-all-targets cargo clippy -p bun_ast -p bun_js_parser --no-deps --all-targets --keep-going
run fmt cargo fmt -p bun_ast -p bun_js_parser -- --check
exit $all
