#!/bin/bash
# Build a prototype bun-debug from the scratch lsquic tree (/tmp/lsq/work) without touching vendor/ or build/.
# usage: build-proto.sh <name>   -> /tmp/lsq/bun-<name>
set -euo pipefail
NAME=$1
WORK=/tmp/lsq/work
VENDOR=/workspace/bun/vendor/lsquic
OBJ=/tmp/lsq/obj-$NAME
mkdir -p "$OBJ"
cd /workspace/bun/build/debug
BASE=$(sed 's#-I/workspace/bun/vendor/lsquic/include#-I/tmp/lsq/work/include#; s#-I/workspace/bun/vendor/lsquic/src/liblsquic#-I/tmp/lsq/work/src/liblsquic#; s#-c /workspace/bun/vendor/lsquic/src/liblsquic/lsquic_send_ctl.c -o .*##' /tmp/lsq/cc_send_ctl.txt)
cp bun-debug.lazy.rsp "/tmp/lsq/$NAME.lazy.rsp"
for f in $(cd "$WORK/src/liblsquic" && ls *.c); do
  [ -f "$VENDOR/src/liblsquic/$f" ] || continue
  if ! cmp -s "$WORK/src/liblsquic/$f" "$VENDOR/src/liblsquic/$f"; then
    echo "compile $f"
    eval "$BASE -c $WORK/src/liblsquic/$f -o $OBJ/$f.o"
    sed -i "s#^obj/vendor/lsquic/src/liblsquic/$f.o\$#$OBJ/$f.o#" "/tmp/lsq/$NAME.lazy.rsp"
  fi
done
grep -c "$OBJ" "/tmp/lsq/$NAME.lazy.rsp"
sed -e "s#-Wl,@bun-debug.lazy.rsp#-Wl,@/tmp/lsq/$NAME.lazy.rsp#" -e "s# -o bun-debug\$# -o /tmp/lsq/bun-$NAME#" /tmp/lsq/link-cmd.txt > "/tmp/lsq/link-$NAME.sh"
bash "/tmp/lsq/link-$NAME.sh"
ls -la "/tmp/lsq/bun-$NAME"
