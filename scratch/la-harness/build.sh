#!/bin/bash
# usage: build.sh <srcdir> <outbin>
# Compiles the libarchive sources in <srcdir> (a copy of vendor/libarchive/libarchive)
# and links the harness against bun's prebuilt (ASAN) zlib objects.
set -euo pipefail
SRC=$1; OUT=$2
BUN=/workspace/bun
OBJ=/tmp/la-harness/obj-$(basename "$OUT")
mkdir -p "$OBJ"
CC=/usr/lib/llvm-23/bin/clang
SAN="-fsanitize=address,undefined -fno-sanitize-recover=undefined"
CFLAGS="-O1 -g $SAN -fno-omit-frame-pointer -I$SRC -I$BUN/build/debug/deps/zlib -I$BUN/build/debug/deps/libarchive -DHAVE_CONFIG_H=1 -DLIBARCHIVE_STATIC=1 -w"
SOURCES=$(bun -e '
const src = require("fs").readFileSync("/workspace/bun/scripts/build/deps/libarchive.ts", "utf8");
const m = src.match(/const SOURCES = \[([\s\S]*?)\];/)[1];
console.log([...m.matchAll(/"([a-z0-9_]+)"/g)].map(x => x[1]).join(" "));
')
pids=()
for s in $SOURCES; do
  if [ ! -f "$OBJ/$s.o" ] || [ "$SRC/$s.c" -nt "$OBJ/$s.o" ] || [ -n "$(find "$SRC" -name '*.h' -newer "$OBJ/$s.o" -print -quit)" ]; then
    $CC $CFLAGS ${LA_COV:+-fsanitize-coverage=trace-pc-guard} -c "$SRC/$s.c" -o "$OBJ/$s.o" &
    pids+=($!)
    if [ ${#pids[@]} -ge 12 ]; then wait "${pids[0]}"; pids=("${pids[@]:1}"); fi
  fi
done
for p in "${pids[@]:-}"; do [ -n "$p" ] && wait "$p"; done
$CC $CFLAGS -c /tmp/la-harness/harness.c -o "$OBJ/harness.o"
ZOBJS=$(find $BUN/build/debug/obj/vendor/zlib -name '*.o')
$CC $SAN -no-pie -o "$OUT" "$OBJ"/*.o $ZOBJS -lm -lpthread
echo "built $OUT"
