#!/bin/bash
# Scratch. Links a copy of the worktree's debug bun with another lsquic_stream.c, without touching the build dir's
# own objects or its bun-debug. Needs /tmp/work/recut2/link-cmd.txt and bun-debug.inputs.txt (see NOTES).
# usage: variant.sh <name> <lsquic_stream.c>
# Output: /tmp/recut/bun/build/debug/bun-debug-<name> (it loads the build dir's generated JS, like bun-debug).
set -euo pipefail
NAME=$1; SRC=$(readlink -f "$2")
B=/tmp/recut/bun/build/debug
V=/tmp/work/recut2/variants/$NAME; rm -rf "$V"; mkdir -p "$V"
OBJ=$V/lsquic_stream.c.o
python3 - "$SRC" "$OBJ" > "$V/cc.sh" <<'PY'
import json, sys
src, obj = sys.argv[1:3]
cc = json.load(open('/tmp/recut/bun/build/debug/compile_commands.json'))
e = [e for e in cc if e['file'].endswith('vendor/lsquic/src/liblsquic/lsquic_stream.c')]
assert len(e) == 1
cmd = e[0].get('command') or ' '.join(e[0]['arguments'])
old_src = '/tmp/recut/bun/vendor/lsquic/src/liblsquic/lsquic_stream.c'
old_obj = '/tmp/recut/bun/build/debug/obj/vendor/lsquic/src/liblsquic/lsquic_stream.c.o'
assert cmd.count('-c ' + old_src) == 1 and cmd.count('-o ' + old_obj) == 1
print(cmd.replace('-c ' + old_src, '-c ' + src).replace('-o ' + old_obj, '-o ' + obj))
PY
(cd "$B" && bash "$V/cc.sh")
cp /tmp/work/recut2/bun-debug.inputs.txt "$V/inputs.rsp"
sed "s|^obj/vendor/lsquic/src/liblsquic/lsquic_stream.c.o\$|$OBJ|" "$B/bun-debug.lazy.rsp" > "$V/lazy.rsp"
grep -c "$OBJ" "$V/lazy.rsp" | grep -qx 1
python3 - "$V" "$NAME" > "$V/link.sh" <<'PY'
import sys
v, name = sys.argv[1:3]
cmd = open('/tmp/work/recut2/link-cmd.txt').read().strip()
assert cmd.count('@bun-debug.rsp') == 1 and cmd.count('-Wl,@bun-debug.lazy.rsp') == 1 and cmd.endswith(' -o bun-debug')
cmd = cmd.replace('@bun-debug.rsp', '@' + v + '/inputs.rsp').replace('-Wl,@bun-debug.lazy.rsp', '-Wl,@' + v + '/lazy.rsp')
cmd = cmd[:-len(' -o bun-debug')] + ' -o bun-debug-' + name
print(cmd)
PY
(cd "$B" && time bash "$V/link.sh")
ls -la "$B/bun-debug-$NAME"
