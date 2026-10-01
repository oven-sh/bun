#!/usr/bin/env python3
"""Per-symbol difference of two cachegrind files.
usage: cgdiff.py <a.cg> <b.cg> [--match REGEX] [--top N]
Prints the symbols whose Ir, Bc or Bi differ, the sums over the matched symbols, and the program totals."""
import re, sys, collections, argparse
ap = argparse.ArgumentParser()
ap.add_argument('a'); ap.add_argument('b'); ap.add_argument('--match', default=r'bun_js_parser|bun_ast'); ap.add_argument('--top', type=int, default=40)
o = ap.parse_args()
def load(path):
    events = []; fn = None; per = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    with open(path, errors='replace') as f:
        for line in f:
            if line.startswith('events:'): events = line.split()[1:]; continue
            if line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)$', '', line[3:].rstrip('\n')); continue
            if line.startswith(('fl=', 'fi=', 'fe=', 'cmd:', 'desc:', 'summary:', 'totals:')): continue
            parts = line.split()
            if not parts or not parts[0].isdigit(): continue
            vals = [int(x) for x in parts[1:1 + len(events)]]; vals += [0] * (5 - len(vals))
            p = per[fn]
            for i in range(5): p[i] += vals[i]
    return per
a = load(o.a); b = load(o.b); rx = re.compile(o.match)
tot = lambda d, i: sum(v[i] for v in d.values())
print(f"program  Ir {tot(a,0):,} -> {tot(b,0):,} ({tot(b,0)-tot(a,0):+,})  Bc {tot(a,1):,} -> {tot(b,1):,} ({tot(b,1)-tot(a,1):+,})  Bi {tot(a,3):,} -> {tot(b,3):,} ({tot(b,3)-tot(a,3):+,})")
names = [n for n in set(a) | set(b) if n and rx.search(n)]
sa = [sum(a[n][i] for n in names if n in a) for i in range(5)]; sb = [sum(b[n][i] for n in names if n in b) for i in range(5)]
print(f"matched /{o.match}/ {len(names)} symbols  Ir {sa[0]:,} -> {sb[0]:,} ({sb[0]-sa[0]:+,})  Bc {sa[1]:,} -> {sb[1]:,} ({sb[1]-sa[1]:+,})  Bi {sa[3]:,} -> {sb[3]:,} ({sb[3]-sa[3]:+,})")
rows = []
for n in names:
    x = a.get(n, [0] * 5); y = b.get(n, [0] * 5)
    if (x[0], x[1], x[3]) != (y[0], y[1], y[3]): rows.append((y[0] - x[0], y[1] - x[1], y[3] - x[3], x[0], n, n not in a, n not in b))
rows.sort(key=lambda r: -abs(r[0]))
print(f"{len(rows)} matched symbols differ")
for dI, dC, dB, base, n, new, gone in rows[:o.top]:
    print(f"  Ir {dI:+12,}  Bc {dC:+11,}  Bi {dB:+9,}  (a Ir {base:,}) {'NEW ' if new else ''}{'GONE ' if gone else ''}{n[:150]}")
