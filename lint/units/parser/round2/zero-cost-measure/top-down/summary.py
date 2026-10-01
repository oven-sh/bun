#!/usr/bin/env python3
"""Parser-matched counts of several tags side by side, per group: Ir, Bc, Bi and the difference to the first tag.
usage: summary.py <dir> <tag> [<tag> ...] [--match REGEX]     files <dir>/<tag>.<group>.cg; default REGEX bun_js_parser|bun_ast"""
import re, sys, collections
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
args = [a for a in sys.argv[1:] if not a.startswith('--')]
d, tags = args[0], args[1:]
rx = re.compile(sys.argv[sys.argv.index('--match') + 1] if '--match' in sys.argv else r'bun_js_parser|bun_ast')
def load(path):
    tot = [0, 0, 0, 0, 0]; par = [0, 0, 0, 0, 0]; on = False
    try: f = open(path, errors='replace')
    except OSError: return None
    with f:
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
for g in G:
    first = None
    for t in tags:
        r = load(f'{d}/{t}.{g}.cg')
        if r is None: print(f'{g:15} {t:12} (no file)'); continue
        tot, par = r
        s = f'{g:15} {t:12} matched Ir {par[0]:>14,} Bc {par[1]:>13,} Bi {par[3]:>11,}'
        if first is None: first = par
        else: s += f'   vs {tags[0]}: Ir {par[0]-first[0]:>+13,} Bc {par[1]-first[1]:>+12,} Bi {par[3]-first[3]:>+10,}'
        print(s)
