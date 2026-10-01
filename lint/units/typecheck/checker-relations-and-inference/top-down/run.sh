#!/bin/sh
# Rebuilds the generated tables of data/ from the call graph and compares them with the stored ones, then checks the Rust scratch.
# The call graph is fns.json of ../../checker-core-scratch/run.sh (default /tmp/k3a/fns.json, with codes.json beside it).
# data/hazards.tsv and data/message_identity.tsv are written by hand. probe/*.out.txt come from ../groundtruth/build.sh:
#   relprobe -strict -trace -funcs lib.es5.d.ts=<TypeScript/src/lib/es5.d.ts> min.ts=probe/min.ts
# usage: run.sh      works in /tmp/relinf-td
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/tmp/relinf-td/check
mkdir -p "$W"
cd "$HERE/py"
python3 tables.py funcs > "$W/functions.tsv"
python3 tables.py in > "$W/standins_in.tsv"
python3 tables.py insum > "$W/standins_in_summary.txt"
python3 tables.py out > "$W/standins_out.tsv"
python3 tables.py outsum > "$W/standins_out_summary.txt"
python3 tables.py later > "$W/later_callees.tsv"
python3 scc.py > "$W/recursion.txt"
python3 rows.py > "$W/port_status_rows.tsv"
for f in functions.tsv standins_in.tsv standins_in_summary.txt standins_out.tsv standins_out_summary.txt later_callees.tsv recursion.txt port_status_rows.tsv; do cmp "$W/$f" "$HERE/data/$f"; done
echo "tables ok"
python3 "$HERE/rust/apply.py" "$HERE/../../conventions-scratch/rust" "$W/rust" "$HERE/rust/fn7_relater.rs"
cd "$W/rust"
rustc --edition 2024 --crate-type lib -o "$W/libconv.rlib" conv.rs
rustc --edition 2024 --test -o "$W/conv_tests" conv.rs
"$W/conv_tests"
CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib -o "$W/libconv_clippy.rlib" conv.rs -D warnings -W clippy::all $(cat "$HERE/../../conventions-scratch/data/clippy_flags.txt")
rustfmt --edition 2024 --check conv.rs
echo "scratch ok"
