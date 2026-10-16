#!/usr/bin/env python3
# Prototype of the probe's alternative, as a binary patch of the branch's release build (same technique as /tmp/mut2/mutate.py).
# Writes /tmp/refute/bun-<name>. Nothing under /workspace/bun or /tmp/bins is modified.
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

REAL_OLD = """    if (@isPromise(maybePromise))
      return maybePromise.then(() => {
        if (cb)
          cb(null);
        emitDrain(this);
      }, (err) => {
        if (cb)
          cb(err);
        (@getInternalField(@internalModuleRegistry, 79) || @createInternalModuleById(79)).errorOrDestroy(this, err), destroyErroredFastStream(this);
      }), !1;"""
REAL_NEW = """    if (@isPromise(maybePromise))
      return parkedFastRun(this, maybePromise).waiting = cb, !1;"""
FINAL_OLD = """    if (@isPromise(maybePromise)) {
      maybePromise.then(() => cb(null), cb);
      return;
    }"""
FINAL_NEW = """    if (@isPromise(maybePromise)) {
      parkedFastRun(this, maybePromise).waiting = cb;
      return;
    }"""
DRAIN_OLD = "if (run.settled = !0, run.err = err, err === null)\n    process.nextTick(emitDrain, stream);"
DRAIN_NEW = "if (run.settled = !0, run.err = err, err === null && !stream._writableState.needDrain)\n    process.nextTick(emitDrain, stream);"

parts = name.split("+")
for p in parts:
    if p == "real":     # a real chunk's onwrite joins the run
        rep(REAL_OLD, REAL_NEW)
    elif p == "final":  # _final's callback joins the run
        rep(FINAL_OLD, FINAL_NEW)
    elif p == "drain":  # Writable emits the 'drain' it owes; the run does not add one
        rep(DRAIN_OLD, DRAIN_NEW)
    elif p == "nodirectdestroy":  # clause (b) removed from the run's own report only: shows that (b) is what re-arms the second reporter
        rep(".errorOrDestroy(stream, err), destroyErroredFastStream(stream);", ".errorOrDestroy(stream, err);")
    elif p == "none":
        pass
    else:
        raise SystemExit("unknown part " + p)

b = js.encode()
slot = len(orig)
delta = len(b) - slot
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
path = "/tmp/refute/bun-" + name.replace("+", "-")
open(path, "wb").write(out); os.chmod(path, 0o755)
print("built", path, "JS bytes delta before padding:", delta)
