#!/usr/bin/env python3
"""Tables of the combined variants against base and head. usage: final_tables.py  (reads /tmp/a2zc/seam/cg and /tmp/zcm-td/cg)"""
import json, os, sys
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
def load(path):
    d = {}
    if not os.path.exists(path) or os.path.getsize(path) == 0: return None
    for l in open(path):
        if '{' not in l: continue
        i = l.index('{'); g = l[:i].split()[1]; d[g] = json.loads(l[i:])
    return d if len(d) == 5 else None
S = {}
for tag, p in [('base', '/tmp/zcm-td/cg/base20b.summary.txt'), ('head', '/tmp/zcm-td/cg/head20b.summary.txt'), ('nolint', '/tmp/zcm-td/cg/nolint.summary.txt'), ('nolintbt', '/tmp/zcm-td/cg/nolintbt.summary.txt'),
               ('vold', '/tmp/zcm-td/cg/vold.summary.txt'), ('v2b', '/tmp/zc1a/seam/cg.v2b.summary.txt'), ('r1', '/tmp/zc1a-r/seam/cg.r1.summary.txt'),
               ('all', '/tmp/a2zc/seam/cg/all.summary.txt'), ('allnolint', '/tmp/a2zc/seam/cg/allnolint.summary.txt'),
               ('rawbase', '/tmp/zcm-td/cg/rawbase.summary.txt'), ('rawhead', '/tmp/zcm-td/cg/rawhead.summary.txt'), ('rawnolintbt', '/tmp/zcm-td/cg/rawnolintbt.summary.txt'), ('rawvold', '/tmp/zcm-td/cg/rawvold.summary.txt'),
               ('rawall', '/tmp/a2zc/seam/cg/rawall.summary.txt'), ('rawallnolint', '/tmp/a2zc/seam/cg/rawallnolint.summary.txt')]:
    S[tag] = load(p)
def row(a, b, ev, scope='matched'):
    if not S.get(a) or not S.get(b): return None
    return [S[b][g][scope][ev] - S[a][g][scope][ev] for g in G]
print(f"{'':26}" + ''.join(f"{g:>15}" for g in G))
for ev in ('Bc', 'Ir', 'Bi'):
    print(f"-- {ev} of symbols matching bun_js_parser (cgsum), default VEX")
    for a, b in [('base', 'head'), ('base', 'nolint'), ('base', 'nolintbt'), ('base', 'vold'), ('base', 'v2b'), ('base', 'r1'), ('base', 'all'), ('base', 'allnolint'), ('allnolint', 'all'), ('head', 'all')]:
        r = row(a, b, ev)
        if r: print(f"{b + ' - ' + a:26}" + ''.join(f"{x:>+15,}" for x in r))
print("-- Bc raw (--vex-guest-chase=no)")
for a, b in [('rawbase', 'rawhead'), ('rawbase', 'rawnolintbt'), ('rawbase', 'rawvold'), ('rawbase', 'rawall'), ('rawbase', 'rawallnolint'), ('rawallnolint', 'rawall')]:
    r = row(a, b, 'Bc')
    if r: print(f"{b + ' - ' + a:26}" + ''.join(f"{x:>+15,}" for x in r))
print("-- absolute, matched: base Bc / Ir / Bi")
for ev in ('Bc', 'Ir', 'Bi'):
    print(f"{'base ' + ev:26}" + ''.join(f"{S['base'][g]['matched'][ev]:>15,}" for g in G))
