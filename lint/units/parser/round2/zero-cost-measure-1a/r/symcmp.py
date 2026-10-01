#!/usr/bin/env python3
"""usage: symcmp.py <a.cg> <b.cg> REGEX  -- per-symbol Ir/Bc of both files for symbols matching REGEX"""
import re, sys, collections
def load(path):
    fn = None; per = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    with open(path, errors='replace') as f:
        for line in f:
            if line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)$', '', line[3:].rstrip('\n')); fn = re.sub(r' \[clone \.llvm\.\d+\]$', '', fn); continue
            if not line[0].isdigit(): continue
            parts = line.split(); vals = [int(x) for x in parts[1:6]]; vals += [0] * (5 - len(vals))
            p = per[fn]
            for i in range(5): p[i] += vals[i]
    return per
a = load(sys.argv[1]); b = load(sys.argv[2]); rx = re.compile(sys.argv[3])
rows = []
for n in set(a) | set(b):
    if n is None or not rx.search(n): continue
    x = a.get(n, [0]*5); y = b.get(n, [0]*5)
    rows.append((y[0]-x[0], x[0], y[0], x[1], y[1], n))
tot = [sum(r[i] for r in rows) for i in range(5)]
print(f'TOTAL dIr {tot[0]:+,}  Ir {tot[1]:,} -> {tot[2]:,}   Bc {tot[3]:,} -> {tot[4]:,} (d {tot[4]-tot[3]:+,})')
for r in sorted(rows, key=lambda r: -abs(r[0]))[:int(sys.argv[4]) if len(sys.argv) > 4 else 40]:
    print(f'  dIr {r[0]:+12,}  Ir {r[1]:>13,} -> {r[2]:>13,}  Bc {r[3]:>12,} -> {r[4]:>12,} ({r[4]-r[3]:+,})  {r[5][:130]}')
