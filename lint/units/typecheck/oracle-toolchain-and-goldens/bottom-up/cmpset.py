# Comparison helper of replay.sh.
# usage: python3 cmpset.py <group> <made dir> <golden dir> [suffix]     every file of the golden dir against the made one, byte by byte
#        python3 cmpset.py --lines <group> <made file> <golden file>    two files; when they differ, how many lines differ
import os, sys

if sys.argv[1] == "--lines":
    group, made, gold = sys.argv[2:5]
    a = open(made, "rb").read()
    b = open(gold, "rb").read()
    if a == b:
        print("%s identical=1 different=0 (%d lines)" % (group, b.count(b"\n")))
    else:
        la, lb = a.split(b"\n"), b.split(b"\n")
        sa, sb = set(la), set(lb)
        print("%s identical=0 different=1 (lines: golden %d, made %d, only in golden %d, only in made %d)" % (group, len(lb), len(la), len(sb - sa), len(sa - sb)))
        for l in sorted(sb - sa)[:3]:
            print("  golden: " + l[:300].decode("utf-8", "replace"))
        for l in sorted(sa - sb)[:3]:
            print("  made:   " + l[:300].decode("utf-8", "replace"))
    sys.exit(0)
group, made, gold = sys.argv[1:4]
suffix = sys.argv[4] if len(sys.argv) > 4 else ""
same, diff = 0, []
for name in sorted(os.listdir(gold)):
    p = os.path.join(gold, name)
    if not os.path.isfile(p) or not name.endswith(suffix):
        continue
    q = os.path.join(made, name)
    if os.path.isfile(q) and open(p, "rb").read() == open(q, "rb").read():
        same += 1
    else:
        diff.append(name + ("" if os.path.isfile(q) else " (not made)"))
print("%s identical=%d different=%d" % (group, same, len(diff)))
for name in diff[:20]:
    print("  differs: " + name)
