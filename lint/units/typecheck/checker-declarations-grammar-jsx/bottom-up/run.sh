#!/bin/sh
# Rebuilds the mechanical tables of data/ from the reference: layer functions, calls in and out, codes, panics, flags, JavaScript sites.
# Needs /tmp/k3a/fns.json (made by ../../checker-core-scratch/run.sh). The coverage tables need groundtruth/run.sh first.
# usage: run.sh      works in /tmp/cdg, then compares with data/
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/tmp/cdg
mkdir -p "$W/py" "$W/data" "$W/doc"
cp "$HERE"/py/*.py "$W/py/"
cp "$HERE"/doc/*.txt "$W/doc/"
cp /tmp/k3a/fns.json "$W/fns.json"
cd "$W"
for m in funcs out cross in panics diags nocaller; do python3 py/layers.py fns.json $m > data/$m.tsv; done
python3 py/flags.py fns.json > data/flags.tsv
python3 py/js.py fns.json > data/js-sites.tsv
python3 py/codes.py > data/smallest-baselines-by-code.txt
python3 py/rows.py fns.json > data/port_status_rows.tsv
if [ -f gt/func/min.func.txt ]; then
  python3 py/tables.py fns.json gt/func/min.func.txt > data/fn-tables.txt
  python3 py/cov.py fns.json gt/func/*.func.txt > data/entered-by-probe.txt
  MISSING=1 python3 py/cov.py fns.json gt/func/*.func.txt | sed -n '/== union/,$p' | grep -v 'not entered Z-SERVICES' > data/entered-union.txt
  python3 py/assemble.py "$W" > /dev/null
fi
for f in funcs.tsv out.tsv cross.tsv in.tsv panics.tsv diags.tsv nocaller.tsv flags.tsv js-sites.tsv smallest-baselines-by-code.txt fn-tables.txt entered-by-probe.txt entered-union.txt work-tables.txt port_status_rows.tsv; do cmp -s "$W/data/$f" "$HERE/data/$f" || echo "differs: $f"; done
python3 py/layers.py fns.json summary
echo "tables ok"
