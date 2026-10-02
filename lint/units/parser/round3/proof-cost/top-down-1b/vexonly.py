#!/usr/bin/env python3
"""Functions whose Bc difference between two builds is not the same with default VEX and with --vex-guest-chase=no.
usage: vexonly.py <dir> <tag a> <a bun-profile> <tag b> <b bun-profile>
Default VEX joins pairs of conditional jumps (`a && b`, `a || b`) into one exit where the layout of the blocks allows it,
so Bc of cgbench.sh moves when blocks move, without a change of the jumps that run. A row here is such a function: the raw
column is the number of conditional jumps that were added or removed, the default column is what cgbench.sh reports."""
import os, subprocess, sys
D, TA, BA, TB, BB = sys.argv[1:6]
HERE = os.path.dirname(os.path.abspath(__file__))
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
def rows(pre, g):
    a = f'{D}/{pre}{TA}.{g}.cg'; b = f'{D}/{pre}{TB}.{g}.cg'
    if not (os.path.exists(a) and os.path.exists(b)): return None
    out = subprocess.run([sys.executable, os.path.join(HERE, 'cgclass.py'), BA, a, BB, b, '--rows'], capture_output=True, text=True).stdout
    r = {}
    for line in out.splitlines():
        i, c, bi, name = line.split('\t', 3); r[name] = (int(i), int(c))
    return r
n = 0
print('%-16s %12s %12s %12s  function' % ('group', 'Bc default', 'Bc raw', 'Ir'))
for g in G:
    d, r = rows('', g), rows('raw', g)
    if d is None or r is None: print('%-16s n/a' % g); continue
    for name in sorted(set(d) | set(r)):
        x = d.get(name, (0, 0)); y = r.get(name, (0, 0))
        if x[1] != y[1]: n += 1; print('%-16s %+12d %+12d %+12d  %s' % (g, x[1], y[1], y[0], name[:120]))
print('%d rows' % n)
