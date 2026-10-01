#!/usr/bin/env python3
"""Per group: the counts of a variant against the base and the head, by cause.
usage: report.py <dir of variant .cg files> <variant> [<variant> ...]   (base and head are read from /workspace/notes/lint/measure/parser/cg)"""
import sys, os, re, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from buckets import load, bucket
REF = '/workspace/notes/lint/measure/parser/cg'
groups = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
rx = re.compile(r'bun_js_parser|bun_ast')
def sums(d):
    tot = [0, 0, 0]; par = [0, 0, 0]; b = collections.defaultdict(lambda: [0, 0, 0])
    for n, v in d.items():
        t = (v[0], v[1], v[3])
        for i in range(3): tot[i] += t[i]
        if n and rx.search(n):
            for i in range(3): par[i] += t[i]
        k = bucket(n)
        for i in range(3): b[k][i] += t[i]
    return tot, par, b
d = sys.argv[1]; variants = sys.argv[2:]
for g in groups:
    base = sums(load(f'{REF}/base.{g}.cg')); head = sums(load(f'{REF}/head.{g}.cg'))
    print(f'== {g}: base program Bc {base[0][1]:,} parser Bc {base[1][1]:,}')
    print(f'   {"head":6} program dIr {head[0][0]-base[0][0]:+13,} dBc {head[0][1]-base[0][1]:+12,} dBi {head[0][2]-base[0][2]:+9,} | parser dIr {head[1][0]-base[1][0]:+13,} dBc {head[1][1]-base[1][1]:+12,} dBi {head[1][2]-base[1][2]:+9,}')
    rows = {'head': head}
    for v in variants:
        p = f'{d}/{v}.{g}.cg'
        if not os.path.exists(p): continue
        s = sums(load(p)); rows[v] = s
        print(f'   {v:6} program dIr {s[0][0]-base[0][0]:+13,} dBc {s[0][1]-base[0][1]:+12,} dBi {s[0][2]-base[0][2]:+9,} | parser dIr {s[1][0]-base[1][0]:+13,} dBc {s[1][1]-base[1][1]:+12,} dBi {s[1][2]-base[1][2]:+9,}')
    keys = sorted(set().union(*[set(r[2]) for r in rows.values()]) | set(base[2]))
    print('   dBc against the base, by cause:        ' + ' '.join(f'{v:>12}' for v in rows))
    for k in keys:
        vals = [rows[v][2][k][1] - base[2][k][1] for v in rows]
        if any(vals): print(f'     {k[:38]:38} ' + ' '.join(f'{x:>+12,}' for x in vals))
