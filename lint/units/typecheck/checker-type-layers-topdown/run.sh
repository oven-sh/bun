#!/bin/sh
# Rebuilds the generated tables of data/ from the reference and compares them with the stored ones.
# The call graph comes from the analysis of ../checker-core-scratch/goanal; the other tables of data/ are written by hand.
# usage: run.sh      works in /tmp/tcl
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/tmp/tcl
mkdir -p "$W/an"
cp "$HERE"/../checker-core-scratch/goanal/* "$W/an/"
export GOTOOLCHAIN=local
(cd "$W/an" && go build -o an . && cd /tmp && "$W/an/an" "$W/fns.json" checker binder)
cd "$HERE/py"
export TCL_WORK=$W
python3 tables.py > "$W/layers.txt"
python3 rows.py > "$W/port_status_rows.tsv"
python3 recursion.py > "$W/recursion.txt"
python3 sites.py writes > "$W/writes.tsv"
python3 sites.py nil > "$W/nil_sites.tsv"
python3 sites.py eager > "$W/eager_args.tsv"
python3 standins.py in > "$W/standins_in.txt"
python3 standins.py later > "$W/standins_later.tsv"
python3 worktables.py > "$W/layers_compact.txt"
for f in layers.txt port_status_rows.tsv recursion.txt writes.tsv nil_sites.tsv eager_args.tsv standins_in.txt standins_later.tsv layers_compact.txt; do cmp "$W/$f" "$HERE/data/$f"; done
echo "tables ok"
