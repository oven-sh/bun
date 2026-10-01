#!/usr/bin/env python3
"""One table over the five groups: per parser symbol the difference of Bc (and Ir with --ir) between two tags.
usage: cgtable.py <dir> <tag a> <tag b> [--ir] [--bi] [--all] [--match REGEX] [--tsv FILE]
Files: <dir>/<tag>.<group>.cg. Parser symbol: bun_js_parser or bun_ast in the name."""
import re, sys, collections
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
d, ta, tb = sys.argv[1:4]
col = 0 if '--ir' in sys.argv else 3 if '--bi' in sys.argv else 1
rxm = re.compile(sys.argv[sys.argv.index('--match') + 1]) if '--match' in sys.argv else None
rx = re.compile(r'bun_js_parser|bun_ast')
def load(path):
    fn = None; per = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n'))
                continue
            if not c.isdigit(): continue
            parts = line.split(); p = per[fn]
            for i in range(1, min(len(parts), 6)): p[i - 1] += int(parts[i])
    return per
A = {g: load(f'{d}/{ta}.{g}.cg') for g in G}; B = {g: load(f'{d}/{tb}.{g}.cg') for g in G}
names = set()
for g in G: names |= set(A[g]) | set(B[g])
rows = []
for n in names:
    if not n or not rx.search(n): continue
    if rxm and not rxm.search(n): continue
    dv = [B[g].get(n, [0] * 5)[col] - A[g].get(n, [0] * 5)[col] for g in G]
    if any(dv) or '--all' in sys.argv:
        st = 'NEW ' if all(n not in A[g] for g in G) else 'GONE' if all(n not in B[g] for g in G) else '    '
        rows.append((dv, st, n))
rows.sort(key=lambda r: -sum(r[0]))
short = lambda n: n.replace('bun_js_parser::', '').replace('parse::type_sink::', '').replace('p::P<', 'P<')
print('%12s %12s %12s %12s %12s  %s' % tuple(G + ['symbol (' + ['Ir', 'Bc', '', 'Bi'][col] + ' ' + tb + ' - ' + ta + ')']))
for dv, st, n in rows:
    print('%+12d %+12d %+12d %+12d %+12d  %s%s' % (*dv, st, short(n)[:150]))
tot = [sum(r[0][i] for r in rows) for i in range(5)]
print('%+12d %+12d %+12d %+12d %+12d  SUM of the rows (%d)' % (*tot, len(rows)))
if '--tsv' in sys.argv:
    with open(sys.argv[sys.argv.index('--tsv') + 1], 'w') as f:
        f.write('\t'.join(G + ['state', 'symbol']) + '\n')
        for dv, st, n in rows: f.write('\t'.join(str(x) for x in dv) + '\t' + st.strip() + '\t' + n + '\n')
