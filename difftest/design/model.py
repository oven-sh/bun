# Syscall-count model (open/openat2 + mkdirat + close + write) for one extraction of each
# package layout in the bun install cache. No real syscalls are issued.
import os, sys, locale, functools, random
cache = os.path.expanduser("~/.bun/install/cache")
def packages():
    for top in sorted(os.listdir(cache)):
        p = os.path.join(cache, top)
        if not os.path.isdir(p) or os.path.islink(p): continue
        if "@@@" in top: yield p
        elif top.startswith("@"):
            for sub in sorted(os.listdir(p)):
                q = os.path.join(p, sub)
                if os.path.isdir(q) and not os.path.islink(q) and "@@@" in sub: yield q
def files_of(pkg):
    out = []
    for d, dirs, fs in os.walk(pkg):
        dirs[:] = [x for x in dirs if not os.path.islink(os.path.join(d, x))]
        for f in fs:
            full = os.path.join(d, f)
            if os.path.islink(full) or not os.path.isfile(full): continue
            out.append(os.path.relpath(full, pkg))
    return out
def npm_key(a):
    base = os.path.basename(a).lower(); ext = os.path.splitext(a)[1].lower()
    return (ext, base, a)
def run(paths, variant):
    exist = {""}              # directories that exist
    n = 0; slot = None; extra_open_close = 0
    for path in paths:
        d = os.path.dirname(path)
        if d in exist:
            n += 3; continue                     # open, write, close
        n += 1                                   # failed open (ENOENT)
        comps = d.split("/")
        missing = []
        for i in range(len(comps), 0, -1):
            pre = "/".join(comps[:i])
            if pre in exist: break
            missing.append(pre)
        missing.reverse(); k = len(missing)
        n += 2 * k - 1                           # main: (k-1) failed probes + k mkdirat
        if variant != "main":
            for m in missing:
                parent = os.path.dirname(m)
                if parent == "": continue        # parent is the root fd: no extra fd
                if variant == "atomic":
                    extra_open_close += 2        # open parent, close parent
                elif variant == "slot":
                    if slot != parent:
                        extra_open_close += 1 + (1 if slot is not None else 0)
                        slot = parent
        for m in missing: exist.add(m)
        n += 3                                   # retry open, write, close
    if variant == "slot" and slot is not None: extra_open_close += 1
    return n + extra_open_close
tot = {}; pk = 0; nf = 0; nd = 0
rnd = random.Random(1)
for pkg in packages():
    fs = files_of(pkg)
    if not fs: continue
    pk += 1; nf += len(fs); nd += len({os.path.dirname(f) for f in fs} - {""})
    orders = {"npm": sorted(fs, key=npm_key), "path": sorted(fs)}
    sh = fs[:]; rnd.shuffle(sh); orders["shuffled"] = sh
    for oname, o in orders.items():
        for v in ("main", "atomic", "slot"):
            tot[(oname, v)] = tot.get((oname, v), 0) + run(o, v)
print(f"packages {pk} files {nf} leaf-dirs {nd}")
for oname in ("npm", "path", "shuffled"):
    m = tot[(oname, "main")]
    for v in ("main", "atomic", "slot"):
        t = tot[(oname, v)]
        print(f"{oname:9s} {v:7s} {t:8d}  {100.0*(t-m)/m:+6.2f}%")
