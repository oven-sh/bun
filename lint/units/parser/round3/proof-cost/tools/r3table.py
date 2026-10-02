#!/usr/bin/env python3
"""The table of the proof of cost: counts of the symbols of bun_js_parser and of the whole program, five groups.
usage: r3table.py <dir> <base tag> <head tag> [--nolint TAG] [--raw] [--match REGEX]
Reads <dir>/<tag>.<group>.cg (cgbench.sh) and, with --raw, <dir>/raw<tag>.<group>.cg (cgbench-raw.sh, --vex-guest-chase=no:
one Bc per executed conditional jump). --nolint TAG: the build with every added test of the side table compiled out;
the executed tests are Bc(head) - Bc(nolint) and are printed per pass and per KB of source.
Passes: 20, and 2,000 parses for tsx. Input bytes: the fixed snapshot of /workspace/notes/lint/benchroot."""
import re, sys, os, collections
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
pos = [a for a in sys.argv[1:] if not a.startswith('--') and a not in (arg('--nolint', None), arg('--match', None))]
D, BASE, HEAD = pos[0], pos[1], pos[2]
NOLINT = arg('--nolint', None); RX = re.compile(arg('--match', 'bun_js_parser'))
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
BYTES = {'bun-types': 1076221, 'typescript-lib': 3784758, 'src-js': 3268179, 'tsx': 7003, 'js-control': 1506667}
PASSES = {'bun-types': 20, 'typescript-lib': 20, 'src-js': 20, 'tsx': 2000, 'js-control': 20}
def load(tag, g):
    path = f'{D}/{tag}.{g}.cg'
    if not os.path.exists(path): return None
    m = [0, 0, 0]; t = [0, 0, 0]; on = False
    with open(path, errors='replace') as f:
        for line in f:
            if line.startswith('fn='): on = bool(RX.search(line)); continue
            if not line[:1].isdigit(): continue
            p = line.split()
            v = (int(p[1]), int(p[2]) if len(p) > 2 else 0, int(p[4]) if len(p) > 4 else 0)
            for i in range(3):
                t[i] += v[i]
                if on: m[i] += v[i]
    return m, t
def row(label, f):
    print(label.ljust(44) + ''.join(f(g).rjust(16) for g in G))
def d(a, b, i, total=False):
    if a is None or b is None: return 'n/a'
    return f'{b[1 if total else 0][i] - a[1 if total else 0][i]:+,}'
print(f'{HEAD} against {BASE}'.ljust(44) + ''.join(g.rjust(16) for g in G))
row('input bytes per pass', lambda g: f'{BYTES[g]:,}')
row('passes', lambda g: f'{PASSES[g]:,}')
modes = [('', 'default VEX')] + ([('raw', '--vex-guest-chase=no')] if '--raw' in sys.argv else [])
for pre, name in modes:
    A = {g: load(pre + BASE, g) for g in G}; B = {g: load(pre + HEAD, g) for g in G}
    N = {g: load(pre + NOLINT, g) for g in G} if NOLINT else None
    print(f'-- {name}')
    row('parser Ir base', lambda g: f'{A[g][0][0]:,}' if A[g] else 'n/a')
    row('parser Ir head - base', lambda g: d(A[g], B[g], 0))
    row('parser Ir head - base, percent', lambda g: f'{100 * (B[g][0][0] - A[g][0][0]) / A[g][0][0]:+.3f}%' if A[g] and B[g] else 'n/a')
    row('parser Bc base', lambda g: f'{A[g][0][1]:,}' if A[g] else 'n/a')
    row('parser Bc head - base', lambda g: d(A[g], B[g], 1))
    row('parser Bc head - base, percent', lambda g: f'{100 * (B[g][0][1] - A[g][0][1]) / A[g][0][1]:+.3f}%' if A[g] and B[g] else 'n/a')
    row('parser Bi head - base', lambda g: d(A[g], B[g], 2))
    row('program Ir head - base', lambda g: d(A[g], B[g], 0, True))
    row('program Bc head - base', lambda g: d(A[g], B[g], 1, True))
    if N:
        row('parser Bc nolint - base', lambda g: d(A[g], N[g], 1))
        row('parser Ir nolint - base', lambda g: d(A[g], N[g], 0))
        row('executed tests = Bc head - nolint', lambda g: d(N[g], B[g], 1))
        row('Ir of the tests = Ir head - nolint', lambda g: d(N[g], B[g], 0))
        row('tests per pass', lambda g: f'{(B[g][0][1] - N[g][0][1]) / PASSES[g]:,.1f}' if N[g] and B[g] else 'n/a')
        row('tests per KB of source', lambda g: f'{(B[g][0][1] - N[g][0][1]) / PASSES[g] / (BYTES[g] / 1000):.2f}' if N[g] and B[g] else 'n/a')
        row('Ir per test', lambda g: f'{(B[g][0][0] - N[g][0][0]) / (B[g][0][1] - N[g][0][1]):.2f}' if N[g] and B[g] and B[g][0][1] != N[g][0][1] else 'n/a')
