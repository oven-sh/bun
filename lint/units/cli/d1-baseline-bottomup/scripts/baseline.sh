#!/bin/bash
# Runs INSIDE the lock, in the unmodified worktree: the guarded bootstrap, then every gate of the baseline once. usage: /workspace/tools/lk baseline.sh [log directory]
W=/workspace/wt/cli
D=${1:-/tmp/cli-d1b/logs}
P=$D/progress.log
mkdir -p $D; cd $W || exit 1
echo "### baseline lock acquired $(date -u +%FT%TZ) HEAD=$(git rev-parse --short=10 HEAD) dirty=$(git status --short | wc -l)" >> $P
step() {
  name=$1; shift
  s=$(date +%s)
  { echo "### cmd: $*"; echo "### start: $(date -u +%FT%TZ)"; } > $D/$name.log
  "$@" >> $D/$name.log 2>&1
  rc=$?
  echo "### finished: $(date -u +%FT%TZ) rc=$rc wall=$(( $(date +%s)-s ))s" >> $D/$name.log
  echo "### $name rc=$rc wall=$(( $(date +%s)-s ))s $(date -u +%FT%TZ)" >> $P
  return $rc
}
# A test file once with the default timeout of a test, and once more with a long one only where the first run failed.
t() {
  name=$1; shift
  step $name "$@" || step $name-timeout180 "$@" --timeout 180000
}
LEAK="BUN_DESTRUCT_VM_ON_EXIT=1 ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$W/test/leaksan.supp"
step 00-bootstrap bash -c 'if [ -x build/debug/bun-debug ] && [ -d node_modules ] && [ -d test/node_modules ] && [ -f vendor/lolhtml/Cargo.toml ]; then echo "bootstrapped: build/debug/bun-debug, node_modules, test/node_modules and vendor/ exist"; else bun install && (cd test && bun install); fi'
step 01-bd-version bun bd -j8 --version || { echo "### build failed, stopping" >> $P; exit 1; }
step 10-cargo-check cargo check -p bun_lint -p bun_runtime --message-format=short
step 11-cargo-clippy cargo clippy -p bun_lint --all-targets --message-format=short
step 12-cargo-clippy-no-deps cargo clippy -p bun_lint --all-targets --no-deps --message-format=short
step 13-cargo-fmt cargo fmt -p bun_lint -- --check
t 20-lint-test bun bd test test/cli/lint/lint.test.ts
t 21-diagnostics-test bun bd test test/cli/lint/diagnostics.test.ts
t 22-rules-test bun bd test test/cli/lint/rules.test.ts
t 23-as-node-test bun bd test test/cli/run/as-node.test.ts
t 24-bun-options-test bun bd test test/cli/env/bun-options.test.ts
t 30-leak-lint-test env $LEAK bun bd test test/cli/lint/lint.test.ts
t 31-leak-diagnostics-test env $LEAK bun bd test test/cli/lint/diagnostics.test.ts
t 32-leak-rules-test env $LEAK bun bd test test/cli/lint/rules.test.ts
t 33-leak-as-node-test env $LEAK bun bd test test/cli/run/as-node.test.ts
t 34-leak-bun-options-test env $LEAK bun bd test test/cli/env/bun-options.test.ts
step 40-cargo-test cargo test -p bun_lint --lib
step 41-rust-miri bun run rust:miri -p bun_lint --lib
echo "### baseline complete $(date -u +%FT%TZ) dirty=$(git status --short | wc -l)" >> $P
