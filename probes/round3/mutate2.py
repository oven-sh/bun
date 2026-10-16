#!/usr/bin/env python3
# Writes /tmp/p1b/mut/bun-<name>: a copy of the release build of the branch (59d02f6044) whose embedded
# internal/fs/streams JS has the named clauses changed ('+' joins clauses). Same in-place technique as /tmp/p1/mutate.py.
import os, re, sys
name = sys.argv[1]
BASE = "/tmp/bins/head"
base = open(BASE + "/bun", "rb").read()
orig = open(BASE + "/streams.release.js", "rb").read()
off = base.find(orig); assert off > 0 and base[off + len(orig)] == 0 and base.find(orig, off + 1) == -1
js = orig.decode()
def rep(old, new):
    global js
    assert js.count(old) == 1, (name, js.count(old), old[:80])
    js = js.replace(old, new)
for clause in name.split("+"):
    if clause == "sync":            # a real chunk that the sink took at once completes inside _write
        rep("process.nextTick(cb, null);\n      return !0;", "cb(null);\n      return !0;")
    elif clause == "finaltick":     # _final never completes inside end()
        rep("  cb(null);\n}\nvar writablePrototypeWrite", "  process.nextTick(cb, null);\n}\nvar writablePrototypeWrite")
    elif clause == "writelen":      # only a chunk that Writable has not dispatched yet holds later writes back
        rep("(state.ending || state.destroyed || state.length > 0)", "(state.ending || state.destroyed || state.length > state.writelen)")
    elif clause == "none":
        pass
    else:
        raise SystemExit("unknown clause " + clause)
b = js.encode()
slot = len(orig)
if len(b) > slot:
    need = len(b) - slot
    def trim(m):
        global need
        if need <= 0: return m.group(0)
        cut = min(need, len(m.group(1)))
        need -= cut
        return "\n" + m.group(1)[cut:]
    js = re.sub(r"\n( +)", trim, js)
    b = js.encode(); assert len(b) == slot, (len(b), slot)
else:
    m = "// build/release/tmp_modules/internal/fs/streams.ts"; assert js.count(m) == 1
    b = js.replace(m, m + " " * (slot - len(b))).encode()
assert len(b) == slot
out = bytearray(base); out[off:off + slot] = b
path = "/tmp/p1b/mut/bun-" + name.replace("+", "-")
open(path, "wb").write(out); os.chmod(path, 0o755)
print("mutant:", name, "->", path)
