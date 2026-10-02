#!/bin/sh
# Probe of src/typecheck/checker/c03_init.rs with rustc and clippy-driver alone (no cargo). One small crate compiles the
# real c03_init.rs in place, beside the real core/{arena,golang,linkstore,tristate}.rs, ast/{flags,ids,symbolflags,
# checkflags,nodeflags}.rs and diagnostics/ of the tree. Everything else is a stand-in with the signature that the tree
# has (c03-probe-lib.rs, c03-probe-stubs-head.rs, c03-probe-stubs-tail.rs): the tree context, the name resolver, the
# evaluator, the data model and the methods of the checker that c03_init.rs calls. Three stand-ins are assumptions,
# because the tree did not have them when this was written: Map and Memo of crate::core (as the contract has them), and
# the seven hooks of checker.go 1505-1806 that createNameResolver passes (as binder/nameresolver.rs takes them).
# usage: sh c03-probe.sh      work directory: $C03_WORK (default /tmp/c03probe-run)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${C03_WORK:-/tmp/c03probe-run}
rm -rf "$W"
mkdir -p "$W"
sed "s#@WORK@#$W#g" "$HERE/c03-probe-lib.rs" > "$W/lib.rs"
python3 "$HERE/c03-probe-gen.py" "$W"
cd "$W"
# 1. Types, borrows and the deny set of the workspace (the root has #![deny(warnings)] and allows dead_code only).
rustc --edition 2024 --crate-type lib --crate-name c03probe --emit=metadata -o c03probe.rmeta lib.rs
# 2. The clippy table of the workspace and the clippy.toml of the repository.
FLAGS=$(sed 's/-D unreachable[-_]pub//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --crate-name c03probe --emit=metadata -o c03probe_clippy.rmeta lib.rs -A dead_code -A unreachable_pub -W clippy::all $FLAGS > clippy.txt 2>&1 || { cat clippy.txt; exit 1; }
if [ -s clippy.txt ]; then cat clippy.txt; exit 1; fi
rustfmt --edition 2024 --check /workspace/wt/typecheck/src/typecheck/checker/c03_init.rs
echo "c03_init.rs: probe ok"
