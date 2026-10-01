#!/bin/bash
# Runs INSIDE the lock: the cargo gates of bun_runtime (it holds lint_command.rs and Arguments.rs) on the unmodified worktree.
W=/workspace/wt/cli
D=/tmp/cli-d1
cd $W || exit 1
echo "### g4 lock acquired $(date -u +%FT%TZ) HEAD=$(git rev-parse --short HEAD) dirty=$(git status --short | wc -l)" >> $D/progress.log
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
step 20-cargo-check-runtime cargo check -p bun_ast -p bun_options_types -p bun_lint -p bun_runtime --message-format=short
step 21-cargo-clippy-runtime cargo clippy -p bun_runtime --no-deps --message-format=short
step 22-cargo-fmt-runtime cargo fmt -p bun_runtime -p bun_ast -p bun_options_types -- --check
echo "### g4 complete $(date -u +%FT%TZ) dirty=$(git status --short | wc -l)" >> $D/progress.log
