#!/bin/sh
# Builds the probe with plain cargo and prints Bun's parse_only tree of each input next to typescript-go's tree.
# Needs a worktree where `bun bd --version` ran once (generated code and vendored crates): the paths of Cargo.toml
# name /workspace/wt/typecheck. The first build compiles the parser crates (minutes): run it under /workspace/tools/lk.
# usage: run.sh <out dir> <name>=<path>...      without arguments: the built-in check on `const x: number = "s";`
# environment: BUNTREE_TARGET (default /tmp/oracle-td/buntree-target), BUN_CODEGEN_DIR (default /workspace/bun/build/debug/codegen, the one it was verified with)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
TARGET=${BUNTREE_TARGET:-/tmp/oracle-td/buntree-target}
export BUN_CODEGEN_DIR=${BUN_CODEGEN_DIR:-/workspace/bun/build/debug/codegen}
export CARGO_TERM_COLOR=never
cp /workspace/wt/typecheck/Cargo.lock "$HERE/Cargo.lock"
if [ $# -gt 0 ]; then
  out=$1; shift
  mkdir -p "$out"
  BUNTREE_OUT=$(cd "$out" && pwd) BUNTREE_ARGS="$*" cargo test --manifest-path "$HERE/Cargo.toml" --offline --target-dir "$TARGET" -- --nocapture --test-threads=1
else
  cargo test --manifest-path "$HERE/Cargo.toml" --offline --target-dir "$TARGET" -- --nocapture --test-threads=1
fi
