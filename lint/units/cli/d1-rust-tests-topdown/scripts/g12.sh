#!/bin/bash
# Runs INSIDE the lock: bootstrap check, the bun:test baseline, the cargo gates of bun_lint on the unmodified worktree.
W=/workspace/wt/cli
D=/tmp/cli-d1
cd $W || exit 1
echo "### g12 lock acquired $(date -u +%FT%TZ) HEAD=$(git rev-parse --short HEAD) dirty=$(git status --short | wc -l)" >> $D/progress.log
step() {
  name=$1; shift
  s=$(date +%s)
  { echo "### cmd: $*"; echo "### start: $(date -u +%FT%TZ)"; } > $D/$name.log
  "$@" >> $D/$name.log 2>&1
  rc=$?
  echo "### finished: $(date -u +%FT%TZ) rc=$rc wall=$(( $(date +%s)-s ))s" >> $D/$name.log
  echo "### $name rc=$rc wall=$(( $(date +%s)-s ))s $(date -u +%FT%TZ)" >> $D/progress.log
  return $rc
}
LEAK="BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$W/test/leaksan.supp"
step 00-install bash -c 'bun install && (cd test && bun install)'
step 01-bd-version bun bd -j8 --version || { echo "### build failed, stopping" >> $D/progress.log; exit 1; }
step 02-lint-test bun bd test test/cli/lint/lint.test.ts --timeout 180000
step 03-diagnostics-test bun bd test test/cli/lint/diagnostics.test.ts --timeout 180000
step 04-rules-test bun bd test test/cli/lint/rules.test.ts --timeout 180000
step 05-as-node-test bun bd test test/cli/run/as-node.test.ts --timeout 180000
step 06-bun-options-test bun bd test test/cli/env/bun-options.test.ts --timeout 180000
step 07-leak-lint-test env $LEAK bun bd test test/cli/lint/lint.test.ts --timeout 180000
step 08-leak-diagnostics-test env $LEAK bun bd test test/cli/lint/diagnostics.test.ts --timeout 180000
step 09-leak-rules-test env $LEAK bun bd test test/cli/lint/rules.test.ts --timeout 180000
step 10-cargo-check cargo check -p bun_lint --message-format=short
step 11-cargo-check-all-targets cargo check -p bun_lint --all-targets --message-format=short
step 12-cargo-clippy cargo clippy -p bun_lint --all-targets --no-deps --message-format=short
step 13-cargo-fmt cargo fmt -p bun_lint -- --check
step 14-cargo-test cargo test -p bun_lint --lib
step 15-cargo-miri env MIRIFLAGS=-Zmiri-tree-borrows cargo miri test -p bun_lint --lib
echo "### g12 complete $(date -u +%FT%TZ) dirty=$(git status --short | wc -l)" >> $D/progress.log
