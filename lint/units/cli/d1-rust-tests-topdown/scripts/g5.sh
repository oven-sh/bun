#!/bin/bash
# Runs INSIDE the lock, in the scratch copy: the full stand-in set for tests that parse and run the rules.
T=/tmp/cli-d1/tree; V=/tmp/cli-d1/variants; D=/tmp/cli-d1/g5; P=/tmp/cli-d1/progress.log
cd $T || exit 1
export BUN_CODEGEN_DIR=/workspace/wt/cli/build/debug/codegen
export MIRIFLAGS=-Zmiri-tree-borrows
echo "### g5 lock acquired $(date -u +%FT%TZ)" >> $P
apply() {
  cp $V/0/lib.rs src/lint/lib.rs; rm -f src/lint/native_test_shims.rs src/lint/probe_tests.rs src/lint/store_probe_tests.rs
  case $1 in
    L1) cp $V/L1/lib.rs src/lint/lib.rs; cp $V/L1/native_test_shims.rs src/lint/; cp $V/probe_tests_v2.rs src/lint/probe_tests.rs;;
    L1S) cp $V/L1S/lib.rs src/lint/lib.rs; cp $V/L1/native_test_shims.rs src/lint/; cp $V/probe_tests_v2.rs src/lint/probe_tests.rs; cp $V/store_probe_tests.rs src/lint/;;
    L2) cp $V/L2/lib.rs src/lint/lib.rs; cp $V/L2/native_test_shims.rs src/lint/; cp $V/probe_tests_v2.rs src/lint/probe_tests.rs;;
  esac
  echo "### applied $1 $(date -u +%FT%TZ)" >> $P
}
step() {
  name=$1; shift
  s=$(date +%s)
  { echo "### cmd: $*"; echo "### start: $(date -u +%FT%TZ)"; } > $D/$name.log
  "$@" >> $D/$name.log 2>&1
  rc=$?
  echo "### finished: $(date -u +%FT%TZ) rc=$rc wall=$(( $(date +%s)-s ))s" >> $D/$name.log
  echo "### g5 $name rc=$rc wall=$(( $(date +%s)-s ))s $(date -u +%FT%TZ)" >> $P
  return $rc
}
apply L1
step l1-test cargo test -p bun_lint --lib
step l2-clippy cargo clippy -p bun_lint --all-targets --no-deps --message-format=short
step l3-fmt cargo fmt -p bun_lint -- --check
step l4-miri cargo miri test -p bun_lint --lib
apply L2
step k1-test cargo test -p bun_lint --lib
step k2-clippy cargo clippy -p bun_lint --all-targets --no-deps --message-format=short
step k3-fmt cargo fmt -p bun_lint -- --check
apply L1S
step s1-test-store cargo test -p bun_lint --lib store_
python3 /tmp/cli-d1/patch_stackcheck.py >> $P 2>&1
step s2-miri-store-parse-only cargo miri test -p bun_lint --lib store_parse_only
step s3-miri-store-parse-for-lint cargo miri test -p bun_lint --lib store_parse_for_lint
cp $V/0/util.rs src/bun_core/util.rs
apply 0
echo "### g5 complete $(date -u +%FT%TZ)" >> $P
