#!/usr/bin/env python3
"""pairs1.py <merged.cts, rewritten in place> <a private file of pairs>: THE TYPES OF WHAT A PATCH ADDS, KEPT BY WHOEVER MAY READ THE PATCH: a line a pair, three fields parted by TABS: <line number in merged.cts> <text that stands exactly once in that line> <what stands in its place>. A line that begins with # is passed over.
ONLY TYPES, `!`, MARKED CASTS AND MARKED DEVICES MAY BE ADDED: step 2's verify says so afterwards. PRINTS COUNTS AND LINE NUMBERS ONLY: nothing of any text. A pair that does not fit stops everything and names its line number."""
import sys
p, q = sys.argv[1], sys.argv[2]; L = open(p).read().split("\n"); n = []
for k, row in enumerate(open(q).read().split("\n"), 1):
    if not row.strip() or row.startswith("#"): continue
    f = row.split("\t")
    if len(f) != 3 or not f[0].strip().isdigit(): sys.exit("pairs1: row %d of the pairs: three fields parted by tabs are due, the first a number" % k)
    i = int(f[0]) - 1
    if not 0 <= i < len(L) or L[i].count(f[1]) != 1: sys.exit("pairs1: row %d of the pairs: at line %s the text stands %s times, 1 is due" % (k, f[0], L[i].count(f[1]) if 0 <= i < len(L) else "no such line:"))
    L[i] = L[i].replace(f[1], f[2]); n.append(int(f[0]))
open(p, "w").write("\n".join(L)); print("pairs1: %d pairs laid in, at lines: %s" % (len(n), " ".join(map(str, n))))
