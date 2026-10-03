#!/usr/bin/env python3
"""cost.py <bun> [env...]: extraction-only syscalls (mkdirat+openat+openat2+close+write+pwrite64) for shapes D A E B C,
first and second extraction, default extractor. Extraction-only = run with extract minus run that only loads the tar."""
import os, re, shutil, subprocess, sys, tempfile
bun = sys.argv[1]
env = {**os.environ, "BUN_DEBUG_QUIET_LOGS": "1", "BUN_RUNTIME_TRANSPILER_CACHE_PATH": "0"}
for kv in sys.argv[2:]:
    k, v = kv.split("=", 1); env[k] = v
HERE = "/tmp/arc/diff"
KEYS = ("mkdirat", "openat", "openat2", "close", "write", "pwrite64")
def run(tar, dest, flag):
    r = subprocess.run([HERE + "/sc", bun, HERE + "/count.mjs", tar, dest, flag], capture_output=True, text=True, env=env)
    m = [l for l in r.stderr.splitlines() if l.startswith("SC ")]
    if r.returncode != 0 or not m:
        print("FAILED", r.returncode, r.stderr[-400:]); sys.exit(1)
    d = dict(kv.split("=") for kv in m[-1].split()[1:])
    return {k: int(d.get(k, 0)) for k in KEYS}, d
rows = {"first": [], "second": []}
detail = []
for shape in "DAEBC":
    tar = "%s/shapes/%s.tar" % (HERE, shape)
    work = tempfile.mkdtemp(prefix="cost-", dir="/tmp")
    base, _ = run(tar, work + "/unused", "0")
    first, d1 = run(tar, work + "/out", "1")
    second, d2 = run(tar, work + "/out", "1")
    rows["first"].append(sum(first.values()) - sum(base.values()))
    rows["second"].append(sum(second.values()) - sum(base.values()))
    detail.append((shape, {k: first[k] - base[k] for k in KEYS}, {k: second[k] - base[k] for k in KEYS}))
    shutil.rmtree(work, ignore_errors=True)
print(bun, " ".join(sys.argv[2:]))
print("          D      A      E      B      C")
for k in ("first", "second"):
    print("%-7s" % k + "".join("%7d" % v for v in rows[k]))
for shape, f, s in detail:
    print(" ", shape, "first", f, "| second", s)
