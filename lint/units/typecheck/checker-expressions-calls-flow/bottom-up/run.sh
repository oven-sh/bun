#!/bin/sh
# Rebuilds the tables of data/ for the twelve layers E-CORE .. F-UNREACH from the reference.
# Input: fns.json of ../../checker-core-scratch/run.sh (it writes /tmp/k3a/fns.json), and the PORT_STATUS rows of ../../checker-type-layers-topdown.
# usage: run.sh [work dir, default /tmp/ecf1a/tables]      the ground truth of the probe is in groundtruth/ (build.sh, run.sh)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:-/tmp/ecf1a/tables}
export FNS=${FNS:-/tmp/k3a/fns.json}
[ -f "$FNS" ] || sh "$HERE/../../checker-core-scratch/run.sh"
mkdir -p "$W"
cd "$HERE/py"
python3 layers.py summary > "$W/summary.txt"
python3 layers.py list > "$W/functions.tsv"
python3 tables.py funcs > "$W/functions-by-layer.txt"
python3 tables.py in > "$W/standins-in.txt"
python3 tables.py inusers > "$W/standins-in-users.tsv"
python3 tables.py out > "$W/standins-out.txt"
python3 tables.py codes > "$W/codes-by-layer.txt"
python3 tables.py fields > "$W/checker-fields-by-layer.tsv"
python3 tables.py links > "$W/link-stores-by-layer.tsv"
for m in panics asserts defers casts program symw; do python3 tables.py $m > "$W/$m.tsv"; done
python3 rows.py > "$W/port_status_rows.tsv"
python3 scc.py > "$W/recursion.txt"
for f in summary.txt functions.tsv functions-by-layer.txt standins-in.txt standins-in-users.tsv standins-out.txt codes-by-layer.txt checker-fields-by-layer.tsv link-stores-by-layer.tsv panics.tsv asserts.tsv defers.tsv casts.tsv program.tsv symw.tsv port_status_rows.tsv recursion.txt; do cmp "$W/$f" "$HERE/data/$f" || echo "differs: $f"; done
echo "tables ok: fallbacks.tsv, state.tsv, depth-top.tsv, depth-summary.tsv, probe-coverage.txt and min.entered.tsv of data/ come from reading, from depth/depth.mjs and from groundtruth/run.sh"
