#!/bin/sh
# Rebuilds the generated tables of data/ from the reference and compares them with the stored ones.
# Inputs: the call graph of ../../checker-core-scratch (its run.sh writes /tmp/k3a/fns.json; Go 1.24 is enough) and the layer
# model and the list of stack tests of ../bottom-up (py/layers.py, data/recursion.txt).
# Written by hand: state_additions.tsv, caches.tsv, tested_entries.tsv, synthetic_nodes.tsv, flow_records.tsv,
# fallbacks_additions.tsv, hazards.txt, measurements.txt. From the probes: k4_*.tsv, go_stack_256k_sample.tsv, depth_scan.txt.
# usage: run.sh            tables only, works in /tmp/ecf1b-run
#        run.sh probe      also runs groundtruth/run.sh (needs the probe binaries, see there)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/tmp/ecf1b-run
mkdir -p "$W"
[ -f /tmp/k3a/fns.json ] || sh "$HERE/../../checker-core-scratch/run.sh"
cd "$HERE/py"
python3 - > "$W/tested_entries.txt" <<'PY'
import re
names = []
for l in open('../../bottom-up/data/recursion.txt'):
    m = re.match(r'^\s+[A-Z-]+\s+(?:checker|flow)\.go:\d+-\d+\s+(?:c\.)?(\w+)', l)
    if m: names.append(m.group(1))
print(' '.join(names))
PY
cmp "$W/tested_entries.txt" "$HERE/data/tested_entries.txt"
python3 tables.py > "$W/layers.txt"
python3 rows.py > "$W/port_status_rows.tsv"
python3 summary.py > "$W/summary.tsv"
python3 recursion.py > "$W/recursion.txt"
for m in faults modes writes state nodes eager; do python3 sites.py $m > "$W/sites_$m.tsv"; done
rm -rf __pycache__ "$HERE/../bottom-up/py/__pycache__"
for f in layers.txt port_status_rows.tsv summary.tsv recursion.txt sites_faults.tsv sites_modes.tsv sites_writes.tsv sites_state.tsv sites_nodes.tsv sites_eager.tsv; do cmp "$W/$f" "$HERE/data/$f"; done
grep -q 'pass no tested entry: 0$' "$W/recursion.txt"
python3 recursion.py --without-printer | grep -q 'pass no tested entry: 0$'
rm -rf __pycache__ "$HERE/../bottom-up/py/__pycache__"
# every entry of the list has a row with the value to return
for n in $(cat "$HERE/data/tested_entries.txt"); do grep -q "	$n(" "$HERE/data/tested_entries.tsv" || { echo "no row: $n"; exit 1; }; done
echo "tables ok"
if [ "$1" = probe ]; then sh "$HERE/groundtruth/run.sh"; fi
