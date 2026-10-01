#!/bin/bash
# Runs INSIDE the lock. First one read-only gate in the worktree, then the stand-in variants in the scratch copy of the workspace at HEAD.
W=/workspace/wt/cli
T=/tmp/cli-d1/tree; V0=/tmp/cli-d1/variants; V=/tmp/cli-d1b/variants; D=/tmp/cli-d1b/scratch-logs; P=/tmp/cli-d1b/progress.log
echo "### scratch lock acquired $(date -u +%FT%TZ)" >> $P
step() {
  name=$1; shift
  s=$(date +%s)
  { echo "### cmd: $*"; echo "### cwd: $(pwd)"; echo "### start: $(date -u +%FT%TZ)"; } > $D/$name.log
  "$@" >> $D/$name.log 2>&1
  rc=$?
  echo "### finished: $(date -u +%FT%TZ) rc=$rc wall=$(( $(date +%s)-s ))s" >> $D/$name.log
  echo "### scratch $name rc=$rc wall=$(( $(date +%s)-s ))s $(date -u +%FT%TZ)" >> $P
  return $rc
}
cd $W || exit 1
step w1-clippy-js-parser cargo clippy -p bun_js_parser --no-deps
cd $T || exit 1
export BUN_CODEGEN_DIR=/workspace/wt/cli/build/debug/codegen
export MIRIFLAGS=-Zmiri-tree-borrows
apply() {
  cp $V0/0/lib.rs src/lint/lib.rs; rm -f src/lint/native_test_shims.rs src/lint/probe_shims.rs src/lint/probe_arena.rs src/lint/probe_tests.rs src/lint/store_probe_tests.rs
  case $1 in
    T) cp $V/T/lib.rs src/lint/lib.rs; cp $V/T/native_test_shims.rs src/lint/;;
    F) cp $V/F/lib.rs src/lint/lib.rs; cp $V/F/native_test_shims.rs src/lint/;;
    P0) cp $V/P0/lib.rs src/lint/lib.rs; cp $V/P0/probe_shims.rs src/lint/;;
    AR) cp $V/AR/lib.rs src/lint/lib.rs; cp $V0/A/native_test_shims.rs src/lint/; cp $V/AR/probe_arena.rs src/lint/;;
  esac
  echo "### applied $1 $(date -u +%FT%TZ)" >> $P
}
apply 0
step z0-pristine diff -rq $W/src/lint $T/src/lint
apply T
step t1-trace cargo test -p bun_lint --lib -- --test-threads=1 --nocapture
apply F
step f1-test cargo test -p bun_lint --lib
step f2-clippy cargo clippy -p bun_lint --all-targets --no-deps --message-format=short
step f3-fmt cargo fmt -p bun_lint -- --check
step f4-miri-lib cargo miri test -p bun_lint --lib
step f5-miri-ci-form cargo miri test -p bun_lint
step f6-check-lib cargo check -p bun_lint --message-format=short
step f7-test-no-lib-flag cargo test -p bun_lint
apply P0
step p1-miri-no-standins cargo miri test -p bun_lint --lib probe_ -- --test-threads=1
apply AR
step r1-link-arena cargo rustc -p bun_lint --lib --profile test -- -C link-arg=-Wl,--error-limit=0
step r2-miri-arena cargo miri test -p bun_lint --lib probe_an_arena
apply F
step x1-check-windows cargo check -p bun_lint --all-targets --target x86_64-pc-windows-msvc --message-format=short
step x2-check-darwin cargo check -p bun_lint --all-targets --target aarch64-apple-darwin --message-format=short
apply 0
step z9-pristine diff -rq $W/src/lint $T/src/lint
echo "### scratch complete $(date -u +%FT%TZ)" >> $P
