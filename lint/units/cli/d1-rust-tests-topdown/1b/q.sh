#!/bin/bash
# Runs INSIDE the lock, in the scratch copy of the workspace at HEAD: probes of StackCheck and of a coloured frame.
W=/workspace/wt/cli
T=/tmp/cli-d1/tree; V=/tmp/cli-d1td/variants; D=/tmp/cli-d1td/logs; P=/tmp/cli-d1td/progress.log
echo "### q lock acquired $(date -u +%FT%TZ)" >> $P
cd $T || exit 1
export BUN_CODEGEN_DIR=/workspace/wt/cli/build/debug/codegen
export MIRIFLAGS=-Zmiri-tree-borrows
restore() {
  cp $V/0/lib.rs $T/src/lint/lib.rs; rm -f $T/src/lint/native_test_shims.rs $T/src/lint/probe_shims.rs $T/src/lint/probe_arena.rs $T/src/lint/probe_tests.rs $T/src/lint/store_probe_tests.rs
}
trap restore EXIT
apply() {
  restore
  case $1 in
    Q1) cp $V/Q1/lib.rs src/lint/lib.rs; cp $V/A/native_test_shims.rs src/lint/; cp $V/Q1/probe_tests.rs src/lint/;;
    Q2) cp $V/Q2/lib.rs src/lint/lib.rs; cp $V/A/native_test_shims.rs src/lint/; cp $V/Q2/probe_tests.rs src/lint/;;
    Q0) cp $V/Q0/lib.rs src/lint/lib.rs; cp $V/Q0/probe_tests.rs src/lint/;;
  esac
  echo "### applied $1 $(date -u +%FT%TZ)" >> $P
}
step() {
  name=$1; shift
  s=$(date +%s)
  { echo "### cmd: $*"; echo "### cwd: $(pwd)"; echo "### start: $(date -u +%FT%TZ)"; } > $D/$name.log
  "$@" >> $D/$name.log 2>&1
  rc=$?
  echo "### finished: $(date -u +%FT%TZ) rc=$rc wall=$(( $(date +%s)-s ))s" >> $D/$name.log
  echo "### q $name rc=$rc wall=$(( $(date +%s)-s ))s $(date -u +%FT%TZ)" >> $P
  return $rc
}
apply 0
step z0-pristine diff -rq $W/src/lint $T/src/lint
apply Q1
step q1-native-probes cargo test -p bun_lint --lib probe_
step q2-miri-coloured-frame-with-standins cargo miri test -p bun_lint --lib probe_a_coloured
step q3-miri-stack-check-default cargo miri test -p bun_lint --lib probe_a_stack_check_without
apply Q2
step q4-link-stack-check-init cargo rustc -p bun_lint --lib --profile test -- -C link-arg=-Wl,--error-limit=0
apply Q0
step q5-miri-coloured-frame-without-standins cargo miri test -p bun_lint --lib probe_a_coloured
apply 0
step z9-pristine diff -rq $W/src/lint $T/src/lint
step c1-clippy-js-parser-primary-relint cargo clippy -p bun_js_parser --no-deps -- -A clippy::blanket_clippy_restriction_lints
echo "### q complete $(date -u +%FT%TZ)" >> $P
