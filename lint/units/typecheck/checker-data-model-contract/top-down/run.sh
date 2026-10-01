#!/bin/sh
# Rebuilds and checks the one scratch package of this pass against the crates of /workspace/wt/typecheck.
# Needs: bun, python3, the reference clone /workspace/ref/typescript-go (89d5d5b), the worktree with a configured build
# (build/debug/codegen), the call graph of ../../checker-core-scratch/run.sh for py/claims.py (default /tmp/k3a/fns.json).
# Heavy steps go through /workspace/tools/lk. Work directory: $CDM_WORK (default /tmp/cdm-td), target directory $CDM_WORK/target.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${CDM_WORK:-/tmp/cdm-td}
M=$W/crate/Cargo.toml
T=$W/target
# 1. The generated flags are what the generator writes.
python3 "$HERE/py/genflags.py" "$HERE/crate/src/checker/flags_generated.rs" --check
# 2. One package: node table prototype, diagnostics scratch, the files of this pass, the edits of py/adapt.py.
sh "$HERE/assemble.sh" "$W"
# 3. rustfmt: the adapted foreign files are formatted in the work directory, the files of this pass must already be clean.
cargo fmt --manifest-path "$M"
(cd "$HERE/crate" && find . -name '*.rs' | sort) | while read -r f; do cmp "$HERE/crate/$f" "$W/crate/$f"; done
# 4. The workspace lints (Cargo.toml of the package), clippy.toml of the worktree, every target.
/workspace/tools/lk cargo check --offline --manifest-path "$M" --target-dir "$T"
CLIPPY_CONF_DIR=/workspace/wt/typecheck /workspace/tools/lk cargo clippy --offline --manifest-path "$M" --target-dir "$T" --all-targets
# 5. The tests of the node table, of the diagnostics and of the checker model, and the test target without the harness.
/workspace/tools/lk cargo test --offline --manifest-path "$M" --target-dir "$T"
# 6. The layer tables of the sibling research units, checked against each other.
if [ -f /tmp/k3a/fns.json ]; then
  python3 "$HERE/py/claims.py" | cmp - "$HERE/data/layer-claims.tsv"
  python3 "$HERE/py/settled.py" | cmp - "$HERE/data/layer-settled.tsv"
fi
echo "checker data model ok"
