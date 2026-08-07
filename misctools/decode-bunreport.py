#!/usr/bin/env python3
import sys, subprocess
url = sys.argv[1]; exe = sys.argv[2] if len(sys.argv) > 2 else None
tail = url.rstrip("/").split("/")[-1]
B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
def read_vlq(s, i):
    val, shift = 0, 0
    while i < len(s):
        d = B64.index(s[i]); i += 1
        cont = d & 32; val += (d & 31) << shift; shift += 5
        if not cont:
            return ((-(val >> 1)) if (val & 1) else (val >> 1)), i
    raise ValueError("truncated")
i = 1 + 1 + 1 + 7            # platform, cmd char, version char, sha7
_, i = read_vlq(tail, i); _, i = read_vlq(tail, i)   # packed features (two VLQs)
frames = []
while i < len(tail):
    if tail[i] == "_": frames.append(None); i += 1; continue
    v, i = read_vlq(tail, i)
    if v == 0: break
    frames.append(v)
print("reason:", tail[i:i+40])
addrs = [hex(f + 0x100000000) for f in frames if f]
print("frames:", len(frames), "known:", len(addrs))
if exe and addrs:
    out = subprocess.run(["atos", "-o", exe, "-l", "0x100000000"] + addrs, capture_output=True, text=True).stdout.splitlines()
    k = 0
    for f in frames:
        if f is None: print("   ??? (unknown image / JS)")
        else: print("  ", out[k] if k < len(out) else addrs[k]); k += 1

