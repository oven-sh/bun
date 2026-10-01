#!/bin/sh
# Rebuilds the mechanical tables of data/ from the reference: functions, call edges, selector writes, panics, diagnostics uses.
# Go 1.24 is enough: the packages are type-checked from source with stand-ins for the third-party imports.
# usage: run.sh      works in /tmp/ctl, the python files read /tmp/ctl/out
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/tmp/ctl
mkdir -p "$W/goanal" "$W/py" "$W/out"
cp "$HERE"/goanal/* "$W/goanal/"
cp "$HERE"/py/*.py "$W/py/"
export GOTOOLCHAIN=local
(cd "$W/goanal" && go build -o "$W/ctlanal" . && cd /tmp && "$W/ctlanal" "$W/out" checker)
cd "$W/py"
python3 tables.py > "$W/tables.txt"
python3 standins2.py > "$W/standins2.txt"
cmp "$W/standins2.txt" "$HERE/data/standins.txt" || echo "differs: standins.txt"
echo "tables in $W: out/funcs.tsv out/edges.tsv out/mutations.tsv out/panics.tsv out/diags.tsv tables.txt standins2.txt"
