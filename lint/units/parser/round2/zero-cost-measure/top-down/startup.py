#!/usr/bin/env python3
"""Splits the counts of a group into the part of one pass and the part that does not repeat (start of the process, exit).
usage: startup.py <dir20> <tag20> <dir1> <tag1> [<dir20> <tag20> <dir1> <tag1>]   (two tags: prints the difference too)
per pass = (count(20) - count(1)) / 19; once = count(1) - per pass. Parser: bun_js_parser or bun_ast in the symbol name."""
import re, sys, collections
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
rx = re.compile(r'bun_js_parser|bun_ast')
def load(path):
    fn = None; tot = [0, 0, 0, 0, 0]; par = [0, 0, 0, 0, 0]; on = False
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fn='): on = bool(rx.search(line))
                continue
            if not c.isdigit(): continue
            parts = line.split()
            for i in range(1, min(len(parts), 6)):
                v = int(parts[i]); tot[i - 1] += v
                if on: par[i - 1] += v
    return tot, par
def split(d20, t20, d1, t1):
    out = {}
    for g in G:
        a, pa = load(f'{d20}/{t20}.{g}.cg'); b, pb = load(f'{d1}/{t1}.{g}.cg')
        row = {}
        for name, x, y in (('program', a, b), ('parser', pa, pb)):
            for k, i in (('Ir', 0), ('Bc', 1), ('Bi', 3)):
                per = (x[i] - y[i]) / 19; row[(name, k)] = (per, y[i] - per)
        out[g] = row
    return out
args = sys.argv[1:]
A = split(*args[0:4]); B = split(*args[4:8]) if len(args) >= 8 else None
for g in G:
    for name in ('program', 'parser'):
        for k in ('Ir', 'Bc', 'Bi'):
            per, once = A[g][(name, k)]
            s = f"{g:15} {name:8} {k}  a: per pass {per:>16,.1f} once {once:>14,.1f}"
            if B:
                p2, o2 = B[g][(name, k)]; s += f"   b: per pass {p2:>16,.1f} once {o2:>14,.1f}   delta per pass {p2 - per:>+14,.1f} once {o2 - once:>+12,.1f}"
            print(s)
