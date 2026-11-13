#!/bin/bash
# usage: count.sh <binary> <symbols> <fixture> [extra build flags]
bin=$1; syms=$2; fix=$3; shift 3
cd /tmp/measure/fix/$fix && rm -rf out /tmp/measure/counts.out && SYMBOLS=$syms ASAN_OPTIONS=detect_leaks=0 BUN_DEBUG_QUIET_LOGS=1 timeout 1500 gdb --readnever -batch -x /tmp/measure/count.py --args $bin build ./src/index.ts --dts --outdir out "$@" > /tmp/measure/gdb.log 2>&1; cat /tmp/measure/counts.out 2>/dev/null | grep counts; echo "out: $(ls out 2>/dev/null | tr '\n' ' ')"; grep -E "^warn|error" /tmp/measure/gdb.log | head -3
