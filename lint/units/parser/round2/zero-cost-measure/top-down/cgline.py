#!/usr/bin/env python3
"""Counts of one cachegrind file per source line inside the functions whose name matches.
usage: cgline.py <file.cg> --fn REGEX [--file REGEX] [--src ROOT] [--top N] [--by bc|ir|bi] [--min N] [--lines A-B]
The line is the line of the innermost inlined frame (the fi=/fe= records). ROOT is the tree the binary was built from."""
import re, sys, collections, argparse, os
ap = argparse.ArgumentParser()
ap.add_argument('cg'); ap.add_argument('--fn', required=True); ap.add_argument('--file', default='.'); ap.add_argument('--src', default='/workspace/wt/parser')
ap.add_argument('--top', type=int, default=40); ap.add_argument('--by', default='bc'); ap.add_argument('--min', type=int, default=1); ap.add_argument('--lines')
o = ap.parse_args()
rfn = re.compile(o.fn); rfile = re.compile(o.file)
per = collections.defaultdict(lambda: [0, 0, 0, 0, 0]); fns = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
fn = None; fl = None; cur = None; on = False
with open(o.cg, errors='replace') as f:
    for line in f:
        c = line[0]
        if c == 'f':
            if line.startswith('fl='): fl = line[3:].rstrip('\n'); cur = fl
            elif line.startswith(('fi=', 'fe=')): cur = line[3:].rstrip('\n')
            elif line.startswith('fn='):
                fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n')); on = bool(rfn.search(fn)); cur = fl
            continue
        if not on or not c.isdigit(): continue
        parts = line.split()
        t = fns[fn]
        for i in range(1, min(len(parts), 6)): t[i - 1] += int(parts[i])
        if not rfile.search(cur): continue
        p = per[(cur, int(parts[0]))]
        for i in range(1, min(len(parts), 6)): p[i - 1] += int(parts[i])
for n, t in sorted(fns.items(), key=lambda kv: -kv[1][0]):
    print(f"fn Ir {t[0]:>13,} Bc {t[1]:>12,} Bi {t[3]:>10,}  {n[:160]}")
key = {'bc': 1, 'ir': 0, 'bi': 3}[o.by]
cache = {}
def text(path, ln):
    if path not in cache:
        p = path if os.path.isabs(path) else os.path.join(o.src, path)
        try: cache[path] = open(p, errors='replace').read().split('\n')
        except OSError: cache[path] = None
    L = cache[path]
    return L[ln - 1].strip()[:110] if L and 0 < ln <= len(L) else ''
rows = [(k, v) for k, v in per.items() if v[key] >= o.min]
if o.lines:
    a, b = (int(x) for x in o.lines.split('-')); rows = [(k, v) for k, v in per.items() if a <= k[1] <= b]; rows.sort(key=lambda kv: kv[0])
else:
    rows.sort(key=lambda kv: -kv[1][key]); rows = rows[:o.top]
print(f"{'Ir':>12} {'Bc':>11} {'Bi':>9}  file:line  source")
for (path, ln), v in rows:
    short = path.replace('src/js_parser/', '')
    print(f"{v[0]:>12,} {v[1]:>11,} {v[3]:>9,}  {short}:{ln}  {text(path, ln)}")
