#!/bin/bash
# Builds the probe that prints the tree of bun_js_parser::Parser::parse_only (bunprobe/), outside the repository.
# usage: bash bunprobe.sh [work dir, default /tmp/oracle-bu]      result: <work dir>/bunparseonly
#   WT=<worktree>   the checkout whose crates are compiled (default /workspace/wt/typecheck); bunprobe/Cargo.toml names
#                   the same directory
# The worktree must be configured (build/debug/codegen/build_options.rs and vendor/ exist: `bun run build --configure-only`).
# cargo runs with the worktree as its directory so that .cargo/config.toml (the linker) and rust-toolchain.toml apply;
# the lock file is the one of the worktree, so no registry access is needed. Run it under /workspace/tools/lk.
set -euo pipefail
W=${1:-/tmp/oracle-bu}
WT=${WT:-/workspace/wt/typecheck}
HERE=$(cd "$(dirname "$0")" && pwd)
B=$W/bunprobe
rm -rf "$B" && mkdir -p "$B"
cp -r "$HERE/bunprobe/Cargo.toml" "$HERE/bunprobe/build.rs" "$HERE/bunprobe/src" "$B/"
cp "$WT/Cargo.lock" "$B/Cargo.lock"
(cd "$WT" && cargo build --offline ${JOBS:+-j $JOBS} --manifest-path "$B/Cargo.toml" --target-dir "$W/bunprobe-target")
cp "$W/bunprobe-target/debug/bunparseonly" "$W/bunparseonly"
echo "built $W/bunparseonly"
