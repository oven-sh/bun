# usage: fxdiff.py <before> <after> <config: browser|bun|browser-min|bun-min>
import sys, os, collections, re
before, after, cfg = sys.argv[1:4]
tot_b = tot_a = 0
changed = 0
added_all = collections.Counter(); removed_all = collections.Counter()
for name in sorted(os.listdir(os.path.join(before, cfg))):
    if not name.endswith(".css"): continue
    b = open(os.path.join(before, cfg, name), encoding="utf8", errors="replace").read()
    a = open(os.path.join(after, cfg, name), encoding="utf8", errors="replace").read()
    tot_b += len(b.encode()); tot_a += len(a.encode())
    if a != b: changed += 1
    if cfg.endswith("-min"):
        split = lambda s: [d.strip() for d in re.split(r"[;{}]", s) if d.strip()]
    else:
        split = lambda s: [l.strip().rstrip(";") for l in s.split("\n") if l.strip()]
    cb = collections.Counter(split(b)); ca = collections.Counter(split(a))
    added = ca - cb; removed = cb - ca
    added_all += added; removed_all += removed
    print(f"{name}: {len(b.encode())} -> {len(a.encode())} bytes, +{sum(added.values())} -{sum(removed.values())} lines{' (changed)' if a != b else ''}")
print(f"TOTAL {cfg}: {tot_b} -> {tot_a} bytes ({tot_a - tot_b:+d}), {changed} of 15 outputs changed")
print("ADDED:")
for k, v in added_all.most_common(60): print(f"  {v:4d}  {k[:150]}")
print("REMOVED:")
for k, v in removed_all.most_common(60): print(f"  {v:4d}  {k[:150]}")
