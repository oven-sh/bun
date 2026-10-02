#!/usr/bin/env python3
"""Writes the five 2000-file tars the cost numbers use, into argv[1]. Fixed seed.
D  flat: 2000 files in the destination root
A  200 leaf directories at depth 4, 10 files each, path-sorted, no directory members (421 directories)
E  A with a directory member for each of the 421 directories
B  2000 leaf directories at depth 6, one file each, path-sorted, no directory members (2656 directories)
C  B with the members in random order
"""
import io, os, random, sys, tarfile
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

def write(name, members):
    with tarfile.open(os.path.join(out, name + ".tar"), "w", format=tarfile.USTAR_FORMAT) as t:
        for kind, path in members:
            i = tarfile.TarInfo(path)
            if kind == "d":
                i.type = tarfile.DIRTYPE; i.mode = 0o755
                t.addfile(i)
            else:
                data = b"x=1;\n"
                i.size = len(data); i.mode = 0o644
                t.addfile(i, io.BytesIO(data))

D = [("f", "f%04d.txt" % n) for n in range(2000)]
A = [("f", "package/dir%02d/sub%d/leaf0/file%02d.txt" % (d, s, f)) for d in range(20) for s in range(10) for f in range(10)]
dirs = []
for _, p in A:
    parts = p.split("/")[:-1]
    for k in range(1, len(parts) + 1):
        d = "/".join(parts[:k])
        if d not in dirs[-8:] and d not in set(dirs):
            dirs.append(d)
E = []
seen = set()
for kind, p in A:
    parts = p.split("/")[:-1]
    for k in range(1, len(parts) + 1):
        d = "/".join(parts[:k])
        if d not in seen:
            seen.add(d); E.append(("d", d))
    E.append((kind, p))
B = [("f", "package/l1_%02d/l2_%02d/l3_%02d/l4_%02d/l5_%02d/f.txt" % (a, b, c, d, e))
     for a in range(5) for b in range(5) for c in range(5) for d in range(4) for e in range(4)]
C = B[:]
random.Random(1).shuffle(C)
for name, members in (("D", D), ("A", A), ("E", E), ("B", B), ("C", C)):
    write(name, members)
    files = sum(1 for k, _ in members if k == "f")
    alld = set()
    for k, p in members:
        parts = p.split("/")[:-1] if k == "f" else p.split("/")
        for j in range(1, len(parts) + 1): alld.add("/".join(parts[:j]))
    print(name, "files", files, "directory members", len(members) - files, "directories", len(alld))
