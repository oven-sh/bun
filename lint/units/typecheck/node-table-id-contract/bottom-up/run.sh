#!/bin/sh
# Rebuilds and checks the node table prototype against the crates of /workspace/wt/typecheck.
# Needs: bun, the reference clone /workspace/ref/typescript-go (89d5d5b), the worktree with `bun run build --configure-only`
# done (build/debug/codegen/build_options.rs, vendor/lolhtml, vendor/rust-argon2), and the cargo registry of the machine.
# Heavy steps go through /workspace/tools/lk. Target directory: $NTC_TARGET (default /tmp/ntc/target).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/workspace/wt/typecheck
T=${NTC_TARGET:-/tmp/ntc/target}
M=$HERE/crate/Cargo.toml
cp $W/Cargo.lock $HERE/crate/Cargo.lock
# 1. The generated files are what the generator writes, and the generator has no problem to report.
(cd $HERE/gen && bun generate.ts ../crate/src/ast --check)
(cd $HERE/gen && bun collisions.ts > ../data/snake-collisions.txt)
# 2. The workspace lints (copied into crate/Cargo.toml from Cargo.toml:181-321), clippy.toml of the worktree, rustfmt.
/workspace/tools/lk cargo check --offline --manifest-path $M --target-dir $T
CLIPPY_CONF_DIR=$W /workspace/tools/lk cargo clippy --offline --manifest-path $M --target-dir $T --all-targets
cargo fmt --manifest-path $M -- --check
# 3. The unit tests, linked by cargo against bun_collections, bun_wyhash and bun_core.
/workspace/tools/lk cargo test --offline --manifest-path $M --target-dir $T
# 4. The measurements need dumps: see dump.sh. Then: $T/release/examples/measure <list of dumps> 3
/workspace/tools/lk cargo build --release --example measure --offline --manifest-path $M --target-dir $T
echo "prototype ok"
