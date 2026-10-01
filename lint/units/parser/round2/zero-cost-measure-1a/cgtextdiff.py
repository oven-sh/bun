#!/usr/bin/env python3
"""Difference of two cachegrind files by source TEXT of the line inside a source function (line numbers move between trees).
usage: cgtextdiff.py <a.cg> <a root> <b.cg> <b root> --fn REGEX [--files REGEX] [--min N]"""
import sys, re, collections
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from cgline import load, Src
def arg(k, d=None): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
a, ra, b, rb = sys.argv[1:5]
frx = re.compile(arg('--files', r'^src/(js_parser|ast)/')); fnrx = re.compile(arg('--fn')); mn = int(arg('--min', 1))
def agg(path, root):
    S = Src(root); per = load(path); out = collections.defaultdict(lambda: [0, 0, 0])
    for (fl, fn, line), v in per.items():
        if not fl or not frx.search(fl): continue
        sf = S.fn(fl, line)
        if not fnrx.search(sf): continue
        k = (fl.split('/')[-1], sf, S.text(fl, line)[:120]); t = out[k]; t[0] += v[0]; t[1] += v[1]; t[2] += v[3]
    return out
A = agg(a, ra); B = agg(b, rb)
rows = []
for k in set(A) | set(B):
    x = A.get(k, [0, 0, 0]); y = B.get(k, [0, 0, 0])
    if abs(y[1] - x[1]) >= mn or (mn == 0 and x != y): rows.append((y[1] - x[1], y[0] - x[0], y[2] - x[2], x[1], y[1], k))
tot = [sum(r[i] for r in rows) for i in range(3)]
print(f'shown rows: dBc {tot[0]:+,} dIr {tot[1]:+,} dBi {tot[2]:+,}')
for r in sorted(rows, key=lambda r: -abs(r[0])):
    print(f'  Bc {r[0]:+10,} ({r[3]:,} -> {r[4]:,})  Ir {r[1]:+10,}  {r[5][0]} {r[5][1]} | {r[5][2]}')
