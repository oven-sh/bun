#!/bin/bash
# Runs INSIDE the lock, in the scratch copy: which stand-ins the test of the stand-ins calls.
W=/workspace/wt/cli
T=/tmp/cli-d1/tree; V0=/tmp/cli-d1/variants; V=/tmp/cli-d1b/variants; D=/tmp/cli-d1b/scratch-logs; P=/tmp/cli-d1b/progress.log
echo "### trace2 lock acquired $(date -u +%FT%TZ)" >> $P
cd $T || exit 1
export BUN_CODEGEN_DIR=/workspace/wt/cli/build/debug/codegen
restore() { cp $V0/0/lib.rs src/lint/lib.rs; rm -f src/lint/native_test_shims.rs src/lint/probe_shims.rs src/lint/probe_arena.rs src/lint/probe_tests.rs src/lint/store_probe_tests.rs; }
trap restore EXIT
restore
cp $V/TF/lib.rs src/lint/lib.rs; cp $V/TF/native_test_shims.rs src/lint/
name=t2-trace-stand-in-test
s=$(date +%s)
{ echo "### cmd: cargo test -p bun_lint --lib native_test_shims -- --test-threads=1 --nocapture"; echo "### cwd: $(pwd)"; echo "### start: $(date -u +%FT%TZ)"; } > $D/$name.log
cargo test -p bun_lint --lib native_test_shims -- --test-threads=1 --nocapture >> $D/$name.log 2>&1
rc=$?
echo "### finished: $(date -u +%FT%TZ) rc=$rc wall=$(( $(date +%s)-s ))s" >> $D/$name.log
echo "### trace2 $name rc=$rc wall=$(( $(date +%s)-s ))s $(date -u +%FT%TZ)" >> $P
restore
diff -rq $W/src/lint $T/src/lint >> $P 2>&1; echo "### trace2 complete $(date -u +%FT%TZ) pristine=$?" >> $P
