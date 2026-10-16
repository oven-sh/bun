#!/usr/bin/env python3
# Writes /tmp/mut2/bun-<name>: a copy of the release build of the branch whose embedded internal/fs/streams JS has ONE clause changed.
# The JS is overwritten in place, so the mutant text is padded (or its indentation trimmed) to the same length.
import os, re, sys
name = sys.argv[1]
BASE = os.environ.get("MUT_BASE", "/tmp/bins/head")
base = open(BASE + "/bun", "rb").read()
orig = open(BASE + "/streams.release.js", "rb").read()
off = base.find(orig); assert off > 0 and base[off + len(orig)] == 0 and base.find(orig, off + 1) == -1
js = orig.decode()
def rep(old, new):
    global js
    assert js.count(old) == 1, (name, js.count(old), old[:80])
    js = js.replace(old, new)

if name == "no-run-marker":            # an accepted write waits for the run that has not settled
    rep("reportFastWrite(this, this[kFastWriteRun], cb);", "reportFastWrite(this, null, cb);")
elif name == "always-new-run":         # one run per promise
    rep("if (current != null && current.promise === promise)\n    return current;", "")
elif name == "settle-inline":          # the reaction runs no user code
    rep("process.nextTick(waiting, null);", "waiting(null);")
elif name == "drain-on-failure":       # no 'drain' for a run that failed
    rep("if (run.settled = !0, run.err = err, err === null)", "if (run.settled = !0, run.err = err, !0)")
elif name == "no-drain":
    rep("if (run.settled = !0, run.err = err, err === null)", "if (run.settled = !0, run.err = err, !1)")
elif name == "no-error-without-marker":  # a failed run that no marker reports
    rep("else if (err !== null && run.markers === 0)", "else if (!1)")
elif name == "error-always":
    rep("else if (err !== null && run.markers === 0)", "else if (err !== null)")
elif name == "settled-marker-waits":   # a marker dispatched after its run settled completes at once
    rep("if (!run.settled)\n      run.waiting = cb;", "if (!0)\n      run.waiting = cb;")
elif name == "settled-error-sync":
    rep("else\n      process.nextTick(failFastMarker, this, cb, run.err);", "else\n      failFastMarker(this, cb, run.err);")
elif name == "not-born-constructed":
    rep("this._final = finalFast, this._construct = @undefined;", "this._final = finalFast, fd != null && (this._construct = @undefined);")
elif name == "idle-marker-async":
    rep("if (data === kFastWriteMarker) {\n    cb(null);\n    return;\n  }", "if (data === kFastWriteMarker) {\n    process.nextTick(cb, null);\n    return;\n  }")
elif name == "keep-settled-run":
    rep("if (stream[kFastWriteRun] === run)\n    stream[kFastWriteRun] = null;\n  ", "")
elif name == "no-length-guard":        # a chunk that Writable holds goes out first
    rep("(state.ending || state.destroyed || state.length > 0)", "(state.ending || state.destroyed)")
elif name == "no-destroy-after-error": # a failed write destroys the stream without autoDestroy too
    rep("if (state.errored && !state.destroyed)\n    stream.destroy();", "")
elif name == "no-destroy-after-marker-error":
    rep("onwrite(err), destroyErroredFastStream(stream);", "onwrite(err);")
elif name == "no-destroy-after-direct-error":
    rep(".errorOrDestroy(stream, err), destroyErroredFastStream(stream);", ".errorOrDestroy(stream, err);")
elif name == "no-destroy-after-real-chunk-error":
    rep(".errorOrDestroy(this, err), destroyErroredFastStream(this);", ".errorOrDestroy(this, err);")
elif name == "none":
    pass
else:
    raise SystemExit("unknown mutant " + name)

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
path = "/tmp/mut2/bun-" + name
open(path, "wb").write(out); os.chmod(path, 0o755)
print("mutant:", name)
