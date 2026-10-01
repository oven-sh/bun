#!/usr/bin/env python3
"""Difference of two cachegrind files by SOURCE function (file + nearest preceding `fn`), independent of inlining.
usage: cglinediff.py <a.cg> <a source root> <b.cg> <b source root> [--files REGEX] [--top N] [--sort Ir|Bc|Bi] [--all] [--other]
--other adds one row per file outside --files (by file, not by function)."""
import sys, re, collections
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from cgline import load, Src
def arg(k, d=None): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
a, ra, b, rb = sys.argv[1:5]
frx = re.compile(arg('--files', r'^src/(js_parser|ast)/'))
def agg(path, root):
    S = Src(root); per = load(path); out = collections.defaultdict(lambda: [0, 0, 0, 0, 0]); rest = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    for (fl, fn, line), v in per.items():
        if fl and frx.search(fl): key = (fl.split('/', 1)[-1] if fl.startswith('src/') else fl, S.fn(fl, line)); t = out[key]
        else: t = rest[(fl or '?', '*')]
        for i in range(5): t[i] += v[i]
    return out, rest
A, RA = agg(a, ra); B, RB = agg(b, rb)
def tot(d, i): return sum(v[i] for v in d.values())
print(f'program      Ir {tot(A,0)+tot(RA,0):,} -> {tot(B,0)+tot(RB,0):,} ({tot(B,0)+tot(RB,0)-tot(A,0)-tot(RA,0):+,})  Bc {tot(A,1)+tot(RA,1):,} -> {tot(B,1)+tot(RB,1):,} ({tot(B,1)+tot(RB,1)-tot(A,1)-tot(RA,1):+,})  Bi ({tot(B,3)+tot(RB,3)-tot(A,3)-tot(RA,3):+,})')
print(f'in --files   Ir {tot(A,0):,} -> {tot(B,0):,} ({tot(B,0)-tot(A,0):+,})  Bc {tot(A,1):,} -> {tot(B,1):,} ({tot(B,1)-tot(A,1):+,})  Bi {tot(A,3):,} -> {tot(B,3):,} ({tot(B,3)-tot(A,3):+,})')
print(f'outside      Ir {tot(RA,0):,} -> {tot(RB,0):,} ({tot(RB,0)-tot(RA,0):+,})  Bc {tot(RA,1):,} -> {tot(RB,1):,} ({tot(RB,1)-tot(RA,1):+,})  Bi {tot(RA,3):,} -> {tot(RB,3):,} ({tot(RB,3)-tot(RA,3):+,})')
sk = {'Ir': 0, 'Bc': 1, 'Bi': 2}[arg('--sort', 'Bc')]
def rows(A, B):
    r = []
    for k in set(A) | set(B):
        x = A.get(k, [0] * 5); y = B.get(k, [0] * 5)
        if (x[0], x[1], x[3]) != (y[0], y[1], y[3]): r.append((y[0] - x[0], y[1] - x[1], y[3] - x[3], x[1], y[1], k, k not in A, k not in B))
    r.sort(key=lambda t: -abs(t[sk])); return r
R = rows(A, B); n = len(R) if '--all' in sys.argv else int(arg('--top', 60))
print(f'{len(R)} source functions differ')
for dI, dC, dB, xa, xb, k, new, gone in R[:n]:
    print(f'  Ir {dI:+12,}  Bc {dC:+11,}  Bi {dB:+9,}  (Bc {xa:,} -> {xb:,}) {"NEW " if new else ""}{"GONE " if gone else ""}{k[0]}  {k[1]}')
if '--other' in sys.argv:
    R = rows(RA, RB); print(f'{len(R)} files outside differ')
    for dI, dC, dB, xa, xb, k, new, gone in R[:n]:
        print(f'  Ir {dI:+12,}  Bc {dC:+11,}  Bi {dB:+9,}  (Bc {xa:,} -> {xb:,}) {"NEW " if new else ""}{"GONE " if gone else ""}{k[0]}')
