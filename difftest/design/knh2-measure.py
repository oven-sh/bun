import subprocess, sys, os, shutil, re
BUN = sys.argv[1]
script = sys.argv[2]
shapes = sys.argv[3].split(",")
extra = sys.argv[4:]  # extra args passed to script after tar dest flag
def run(tar, dest, flag):
    p = subprocess.run(["/tmp/arc/sc", BUN, script, tar, dest, flag] + extra, capture_output=True, text=True)
    m = re.search(r"SC total=(\d+)(.*)", p.stderr)
    if not m:
        print("no SC line", p.returncode, p.stderr[-400:], p.stdout[-200:]); sys.exit(1)
    if p.returncode != 0:
        print("exit", p.returncode, p.stderr[-400:])
    d = {k: int(v) for k, v in re.findall(r"(\w+)=(\d+)", m.group(2))}
    d["total"] = int(m.group(1))
    return d
KEYS = ["openat", "openat2", "close", "mkdirat", "write", "pwrite64", "symlinkat", "unlinkat", "newfstatat", "fstat", "statx", "lseek", "ftruncate"]
for s in shapes:
    tar = f"/tmp/knh2/tars/{s}.tar"
    dest = f"/tmp/knh2/out-{s}-{os.getpid()}"
    shutil.rmtree(dest, ignore_errors=True)
    base = run(tar, dest + "-none", "0")
    first = run(tar, dest, "1")
    second = run(tar, dest, "1")
    shutil.rmtree(dest, ignore_errors=True)
    def diff(a):
        return {k: a.get(k, 0) - base.get(k, 0) for k in KEYS + ["total"]}
    for label, r in (("first", diff(first)), ("second", diff(second))):
        five = sum(r[k] for k in ("openat", "openat2", "close", "mkdirat", "write", "pwrite64"))
        print(s, label, "sum6=%d" % five, "all-named=%d" % sum(r[k] for k in KEYS), "total=%d" % r["total"], " ".join(f"{k}={r[k]}" for k in KEYS if r[k]))
