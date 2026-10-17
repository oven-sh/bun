#!/usr/bin/env python3
"""report.py <counts.tsv>.. [--by producer | form] [--since "YYYY-MM-DD HH:MM"]: sums the farm's counts: runs of programs by form of build and collector mode, or by producer, with the verdicts."""
import collections, sys
a = sys.argv[1:]
by = a[a.index("--by") + 1] if "--by" in a else "form"
since = a[a.index("--since") + 1] if "--since" in a else ""
files = [x for i, x in enumerate(a) if not x.startswith("--") and (i == 0 or a[i - 1] not in ("--by", "--since"))]
table = collections.defaultdict(collections.Counter)
for path in files:
    for line in open(path):
        stamp, build, form, mode, producer, verdict, n = line.rstrip("\n").split("\t")[:7]
        if stamp < since or form == "-": continue
        key = producer if by == "producer" else "%s %s" % (form, mode) if by == "form" else "%s %s" % (form, build)
        table[key][verdict] += int(n)
judged = ("same", "refused", "CRASH", "SANITIZER", "ASSERTION", "PANIC", "HANG", "DIFFERENT", "REFUSED", "NOT-COMPILED")
verdicts = sorted({v for c in table.values() for v in c}, key=lambda v: (v.isupper(), v))
print("| %s | judged | %s |" % (by, " | ".join(verdicts)))
print("|---|" + "---:|" * (len(verdicts) + 1))
for key in sorted(table):
    c = table[key]
    print("| %s | %d | %s |" % (key, sum(c[v] for v in judged), " | ".join(str(c[v]) if c[v] else "" for v in verdicts)))
total = collections.Counter()
for c in table.values(): total.update(c)
print("| all | %d | %s |" % (sum(total[v] for v in judged), " | ".join(str(total[v]) if total[v] else "" for v in verdicts)))
