# Functions of the twelve layers (and of every other zone) that a coverage run of the reference entered.
# usage: cov.py <covdata func output> [zone|all|mine|zones]
import sys, re, collections
from zones import *
bydecl = {}
for f in fns:
    bydecl[(f['file'], f['decl'])] = f
rows = []
for l in open(sys.argv[1]):
    m = re.match(r'github.com/microsoft/typescript-go/internal/(\S+?):(\d+):\s+(\S+)\s+([\d.]+)%', l)
    if not m or float(m.group(4)) == 0: continue
    f = bydecl.get((m.group(1), int(m.group(2))))
    rows.append((f['zone'] if f else '?' + m.group(1), m.group(1), int(m.group(2)), m.group(3), float(m.group(4)), f))
mode = sys.argv[2] if len(sys.argv) > 2 else 'mine'
if mode == 'zones':
    c = collections.Counter(r[0] for r in rows)
    for z, n in sorted(c.items(), key=lambda kv: (RANK.get(kv[0], 99), kv[0])): print('%s\t%d' % (z, n))
    print('total\t%d' % len(rows))
else:
    for r in sorted(rows, key=lambda r: (RANK.get(r[0], 99), r[0], r[1], r[2])):
        if mode == 'all' or (mode == 'mine' and r[5] is not None and r[5]['mine']) or r[0] == mode:
            print('%s\t%s:%d\t%s\t%.1f' % (r[0], r[1].split('/')[-1], r[2], r[3], r[4]))
