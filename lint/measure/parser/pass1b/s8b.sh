#!/bin/bash
# clippy with --keep-going and the full rendering, default targets and all targets
cd /workspace/wt/parser || exit 9
O=/tmp/pbb1b/logs/check
s=$(date +%s); cargo clippy -p bun_ast -p bun_js_parser --no-deps --keep-going > $O/clippy-keep-going.full.log 2>&1; echo "clippy default targets rc=$? $(( $(date +%s) - s ))s" | tee -a $O/summary.txt
s=$(date +%s); cargo clippy -p bun_ast -p bun_js_parser --no-deps --all-targets --keep-going > $O/clippy-all-targets-keep-going.full.log 2>&1; echo "clippy all targets rc=$? $(( $(date +%s) - s ))s" | tee -a $O/summary.txt
grep -c "^error" $O/clippy-keep-going.full.log $O/clippy-all-targets-keep-going.full.log
