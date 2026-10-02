#!/usr/bin/env python3
"""Difference of two cachegrind files per SOURCE LINE TEXT inside the functions whose name matches.
usage: cglinediff.py <a.cg> <b.cg> --fn REGEX [--fnb REGEX] [--srca ROOT] [--srcb ROOT] [--by bc|ir|bi] [--top N] [--all]
Lines are joined by (file, text of the line) because line numbers moved between the two trees; a line whose text occurs
twice in a file is one row. --fnb: the function names on the b side when they differ (renamed or split functions)."""
import re, sys, collections, argparse, os
ap = argparse.ArgumentParser()
ap.add_argument('a'); ap.add_argument('b'); ap.add_argument('--fn', required=True); ap.add_argument('--fnb')
ap.add_argument('--srca', default='/tmp/proofcost/base-src'); ap.add_argument('--srcb', default='/workspace/wt/parser')
ap.add_argument('--by', default='bc'); ap.add_argument('--top', type=int, default=60); ap.add_argument('--all', action='store_true')
o = ap.parse_args()
def load(path, rfn, src):
    per = collections.defaultdict(lambda: [0, 0, 0, 0, 0]); tot = [0, 0, 0, 0, 0]; where = {}
    fn = None; fl = None; cur = None; on = False; cache = {}
    def text(p, ln):
        if p not in cache:
            q = p if os.path.isabs(p) else os.path.join(src, p)
            try: cache[p] = open(q, errors='replace').read().split('\n')
            except OSError: cache[p] = None
        L = cache[p]
        return L[ln - 1].strip() if L and 0 < ln <= len(L) else '<line %d>' % ln
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fl='): fl = line[3:].rstrip('\n'); cur = fl
                elif line.startswith(('fi=', 'fe=')): cur = line[3:].rstrip('\n')
                elif line.startswith('fn='):
                    fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n')); on = bool(rfn.search(fn)); cur = fl
                continue
            if not on or not c.isdigit(): continue
            parts = line.split(); ln = int(parts[0])
            short = re.sub(r'^.*/rustlib/src/rust/library/', 'std:', cur).replace('src/js_parser/', '')
            k = (short, text(cur, ln)); p = per[k]; where.setdefault(k, ln)
            for i in range(1, min(len(parts), 6)): v = int(parts[i]); p[i - 1] += v; tot[i - 1] += v
    return per, tot, where
A, ta, wa = load(o.a, re.compile(o.fn), o.srca); B, tb, wb = load(o.b, re.compile(o.fnb or o.fn), o.srcb)
key = {'bc': 1, 'ir': 0, 'bi': 3}[o.by]
print(f"functions a: Ir {ta[0]:,} Bc {ta[1]:,} Bi {ta[3]:,}   b: Ir {tb[0]:,} Bc {tb[1]:,} Bi {tb[3]:,}   delta Ir {tb[0]-ta[0]:+,} Bc {tb[1]-ta[1]:+,} Bi {tb[3]-ta[3]:+,}")
rows = []
for k in set(A) | set(B):
    x = A.get(k, [0] * 5); y = B.get(k, [0] * 5)
    if x[key] != y[key] or (o.all and (x[key] or y[key])): rows.append((y[key] - x[key], x[key], y[key], y[0] - x[0], k))
rows.sort(key=lambda r: -abs(r[0]))
print(f"{len(rows)} lines differ in {o.by}; sum {sum(r[0] for r in rows):+,}")
print(f"{'delta':>11} {'a':>11} {'b':>11} {'dIr':>11}  file:line(a|b)  text")
for d, x, y, dI, k in rows[:o.top]:
    print(f"{d:>+11,} {x:>11,} {y:>11,} {dI:>+11,}  {k[0]}:{wa.get(k, '-')}|{wb.get(k, '-')}  {k[1][:100]}")
