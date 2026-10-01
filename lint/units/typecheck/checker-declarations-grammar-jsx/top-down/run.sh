#!/bin/sh
# Rebuilds data/ of the top-down pass: corpus execution of the layer functions, the service functions that diagnostics execute,
# options and state by layer, the K4 run, fault sites, recursion, stand-ins for earlier layers, messages shared with the parser.
# Inputs made by other passes (all under /tmp, rebuilt by their own scripts):
#   /tmp/cdg/fns.json and /tmp/cdg/gt/func/min.func.txt   ../bottom-up/run.sh and ../bottom-up/groundtruth/run.sh
#   /tmp/ctp/cover.diag.out cover.diagdecl.out cover.full.out   ../../checker-type-printer/bottom-up/groundtruth/build.sh
# usage: run.sh      works in /tmp/cdg-td, then compares with data/
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/tmp/cdg-td
mkdir -p "$W/py" "$W/data"
cp "$HERE"/py/*.py "$W/py/"
cd "$W"
F=/tmp/cdg/fns.json; D=/tmp/ctp/cover.diag.out; X=/tmp/ctp/cover.diagdecl.out; E=/tmp/ctp/cover.full.out; K=/tmp/cdg/gt/func/min.func.txt
python3 py/corpus.py $F $D $E summary > data/corpus-summary.tsv
python3 py/corpus.py $F $D $E never > data/never-run.tsv
python3 py/corpus.py $F $D $E panics > data/panics-corpus.tsv
python3 py/corpus.py $F $D $E partial > data/blocks-never-run.tsv
python3 py/services.py $F $D > data/services-run-by-diagnostics.tsv
python3 py/svc_classes.py $F $D $X $E > data/services-classes.tsv
python3 py/options.py $F > data/options.tsv
python3 py/state.py $F > data/state.tsv
python3 py/k4.py $F $K > data/k4.txt
python3 py/k4ext.py $F $K > data/k4-external-callees.txt
python3 py/faults.py $F > data/index-sites.tsv
python3 py/recursion.py $F > data/recursion.tsv
python3 py/insig.py $F > data/standins-for-earlier-layers.tsv
python3 py/shared.py > data/parser-shared-codes.txt
for f in data/*; do cmp -s "$W/$f" "$HERE/$f" || echo "differs: $f"; done
echo "tables ok"
