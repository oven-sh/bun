#!/bin/sh
# Rebuilds the tables of data/ from the reference: outline, call graph with symbol writes, layers, split, fields.
# Go 1.24 is enough: the packages are type-checked from source with stand-ins for the third-party imports.
# usage: run.sh      works in /tmp/k3a, then compare /tmp/k3a/*.tsv with data/
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=/tmp/k3a
mkdir -p "$W/py" "$W/an" "$W/outline"
cp "$HERE"/py/*.py "$W/py/"
cp "$HERE"/goanal/* "$W/an/"
cp "$HERE"/outline/* "$W/outline/"
export GOTOOLCHAIN=local
(cd "$W/outline" && go build -o outline . && ./outline /workspace/ref/typescript-go/internal/checker/checker.go > "$W/checker.outline.tsv")
(cd "$W/an" && go build -o an . && cd /tmp && "$W/an/an" "$W/fns.json" checker binder)
cd "$W"
python3 py/split.py > split.tsv
python3 py/fields.py > fields.tsv
python3 py/standins_all.py > standins.tsv
python3 py/layers.py panics > panics.tsv
python3 py/q.py symw > symbol_writes.tsv
python3 py/q.py program > program_calls.tsv
python3 py/q.py tracer > tracer_sites.tsv
python3 py/scc.py > recursion_scc.txt
python3 py/ext.py > external_callees.txt
for L in TYPES LINKS MAPPER UTIL T-KEYS K-OBJ T-RSTACK C-INIT D-SINK S-MERGE N-RESOLVE N-DIAG A-ALIAS M-MODULE Q-ENTITY; do echo "== $L"; python3 py/layers.py funcs $L; echo "-- stand-ins $L"; python3 py/layers.py standins $L; done > layers.txt
for f in split.tsv fields.tsv standins.tsv panics.tsv symbol_writes.tsv program_calls.tsv tracer_sites.tsv recursion_scc.txt external_callees.txt layers.txt checker.outline.tsv; do cmp "$W/$f" "$HERE/data/$f" || echo "differs: $f"; done
echo "tables ok"
