#!/bin/bash
# baseline of check, clippy and fmt for the two crates the parser unit owns, at HEAD
cd /workspace/wt/parser || exit 9
O=/tmp/pbb1b/logs/check; mkdir -p $O; : > $O/summary.txt
overall=0
step() {
  name=$1; shift
  s=$(date +%s)
  "$@" > $O/$name.log 2>&1; rc=$?
  echo "$name rc=$rc $(( $(date +%s) - s ))s warnings=$(grep -ac 'warning' $O/$name.log) errors=$(grep -ac '^error' $O/$name.log) :: $*" | tee -a $O/summary.txt
  [ $rc -ne 0 ] && overall=1
}
step check cargo check -p bun_ast -p bun_js_parser --message-format=short
step check-all-targets cargo check -p bun_ast -p bun_js_parser --all-targets --message-format=short
step clippy cargo clippy -p bun_ast -p bun_js_parser --message-format=short
step clippy-all-targets cargo clippy -p bun_ast -p bun_js_parser --all-targets --message-format=short
step fmt cargo fmt -p bun_ast -p bun_js_parser -- --check
exit $overall
