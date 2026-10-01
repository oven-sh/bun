#!/bin/bash
# Runs INSIDE the lock, in a scratch copy of the workspace at HEAD: the stand-in variants for the test binary of bun_lint.
T=/tmp/cli-d1/tree; V=/tmp/cli-d1/variants; D=/tmp/cli-d1/g3; P=/tmp/cli-d1/progress.log
cd $T || exit 1
export BUN_CODEGEN_DIR=/workspace/wt/cli/build/debug/codegen
export MIRIFLAGS=-Zmiri-tree-borrows
echo "### g3 lock acquired $(date -u +%FT%TZ)" >> $P
apply() {
  cp $V/0/lib.rs src/lint/lib.rs; rm -f src/lint/native_test_shims.rs src/lint/probe_tests.rs
  case $1 in
    A) cp $V/A/lib.rs src/lint/lib.rs; cp $V/A/native_test_shims.rs src/lint/;;
    AP) cp $V/AP/lib.rs src/lint/lib.rs; cp $V/A/native_test_shims.rs src/lint/; cp $V/probe_tests.rs src/lint/;;
    B) cp $V/B/lib.rs src/lint/lib.rs; cp $V/probe_tests.rs src/lint/;;
    C) cp $V/C/lib.rs src/lint/lib.rs; cp $V/C/native_test_shims.rs src/lint/; cp $V/probe_tests.rs src/lint/;;
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
  echo "### g3 $name rc=$rc wall=$(( $(date +%s)-s ))s $(date -u +%FT%TZ)" >> $P
  return $rc
}
apply A
step a1-test cargo test -p bun_lint --lib
step a2-clippy cargo clippy -p bun_lint --all-targets --no-deps --message-format=short
step a3-fmt cargo fmt -p bun_lint -- --check
step a4-miri-lib cargo miri test -p bun_lint --lib
step a5-miri-ci-form cargo miri test -p bun_lint
apply AP
step ap1-link-all-undefined cargo rustc -p bun_lint --lib --profile test -- -C link-arg=-Wl,--error-limit=0
apply B
step b1-test cargo test -p bun_lint --lib
step b2-clippy cargo clippy -p bun_lint --all-targets --no-deps --message-format=short
step b3-fmt cargo fmt -p bun_lint -- --check
step b4-miri-no-parse cargo miri test -p bun_lint --lib -- --skip probe_
step b5-miri-parse cargo miri test -p bun_lint --lib probe_parse_only
apply C
step c1-test cargo test -p bun_lint --lib
step c2-clippy cargo clippy -p bun_lint --all-targets --no-deps --message-format=short
step c3-fmt cargo fmt -p bun_lint -- --check
apply B
python3 /tmp/cli-d1/patch_stackcheck.py >> $P 2>&1
step m1-miri-parse-stackcheck-fallback cargo miri test -p bun_lint --lib probe_
cp $V/0/util.rs src/bun_core/util.rs
apply 0
echo "### g3 complete $(date -u +%FT%TZ)" >> $P
