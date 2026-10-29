#!/bin/sh
# Builds the measurement tools beside their sources. Linux only.
cd "$(dirname "$0")"
for t in keepawake keepawake2 hogs wakelat ctxsw; do cc -O2 -pthread -o $t $t.c || exit 1; done
cc -O2 -shared -fPIC -o counts.so counts.c -ldl
