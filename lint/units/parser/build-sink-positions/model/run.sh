#!/bin/sh
# Builds the model of the sink protocol without and with the building sink and compares the code of the other sinks.
# usage: sh run.sh   (in this directory; writes to /tmp/bun-sink-model)
set -e
O=/tmp/bun-sink-model; mkdir -p $O/p1 $O/p2
F="--edition 2024 --crate-name bun_js_parser --crate-type bin -C opt-level=3 -C codegen-units=1 -C symbol-mangling-version=v0 -C debuginfo=0 -C panic=abort"
rustc +nightly-2026-09-15 $F -o $O/p1/model model.rs
rustc +nightly-2026-09-15 $F --cfg p2 -o $O/p2/model model.rs
python3 ../fnasm.py $O/p1/model $O/p1.json
python3 ../fnasm.py $O/p2/model $O/p2.json
python3 cmp.py $O/p1.json $O/p2.json 20
$O/p2/model in3.txt
