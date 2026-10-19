#!/bin/bash
# Runs the oracle over the workspace for three targets, one after the other.
cd /workspace/bun
SYSROOT=$(rustc --print sysroot)
export RUSTC_WORKSPACE_WRAPPER=/tmp/oracle/target/release/default-oracle ORACLE_SYSROOT=$SYSROOT ORACLE_ROOT=/workspace/bun LD_LIBRARY_PATH=$SYSROOT/lib BUN_CODEGEN_DIR=/workspace/bun/build/debug/codegen
OUT=${1:-/tmp/oracle-f0}
rm -rf "$OUT" /tmp/oracle-target/debug/build/bun_* /tmp/oracle-target/debug/incremental /tmp/oracle-target/*/debug/build/bun_* /tmp/oracle-target/*/debug/incremental
mkdir -p "$OUT"
ORACLE_OUT=$OUT/linux cargo check --workspace --all-targets --keep-going --target-dir /tmp/oracle-target > $OUT/linux.log 2>&1
echo "linux exit $?" >> $OUT/status
ORACLE_OUT=$OUT/win cargo check --workspace --all-targets --keep-going --target x86_64-pc-windows-msvc --target-dir /tmp/oracle-target > $OUT/win.log 2>&1
echo "win exit $?" >> $OUT/status
ORACLE_OUT=$OUT/mac cargo check --workspace --all-targets --keep-going --target aarch64-apple-darwin --target-dir /tmp/oracle-target > $OUT/mac.log 2>&1
echo "mac exit $?" >> $OUT/status
echo done >> $OUT/status
