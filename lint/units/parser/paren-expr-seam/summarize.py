#!/usr/bin/env python3
"""One block per variant: what the ThinLTO link makes of it against its reference (stub for the lint variants, base for P1).
usage: summarize.py [<variant> ...]      reads /tmp/paren-seam/link/<tag>/bun_js_parser.lto.o and /tmp/paren-seam/cg.<tag>.txt
Columns per changed function: instructions a -> b, conditional branches a -> b, bytes a -> b. `lint-only` sums the functions
that exist only in the variant (twin, helpers). JS = P<false,*>, scan = P<true,true>."""
import json, os, re, subprocess, sys
sys.argv = [a for a in sys.argv]
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
L = '/tmp/paren-seam/link/%s/bun_js_parser.lto.o'
ORDER = ['stub', 'v1', 'v1t', 'v1types', 'v1paren', 'v1parent', 'fastparen', 'fastparent', 'v2', 'v2g', 'v2gt', 'v2gts', 'v2mi', 'v2m', 'v2m2', 'v2mm', 'v3', 'v3t', 'v3open', 'v3opent', 'v5', 'v5n', 'v5inl', 'v5p', 'v5t', 'topw', 'topwjs', 'w1', 'w1b', 'w1f', 'w1s', 'w2', 'p1a', 'p1b', 'p1c', 'p1cu', 'p1d', 'p1c2', 'p1abc', 'p1abc2']
tags = [a for a in sys.argv[1:]] or ORDER
import importlib.util
def load_objfn():
    src = open(here + '/objfn.py').read().split("paths = [a for a in sys.argv[1:]")[0]
    g = {'__name__': 'objfn'}; exec(compile(src, 'objfn.py', 'exec'), g); return g
saved = sys.argv; sys.argv = ['objfn.py']; o = load_objfn(); sys.argv = saved
cache = {}
def get(tag):
    if tag not in cache: cache[tag] = o['load'](L % tag)
    return cache[tag]
def cg(tag):
    p = '/tmp/paren-seam/cg.%s.txt' % tag
    if not os.path.exists(p): return None
    r = {}
    for l in open(p):
        parts = l.split(' ', 2)
        if len(parts) == 3 and parts[2].startswith('{'): r[parts[1]] = json.loads(parts[2])['matched']
    return r
cgbase = cg('base0')
for tag in tags:
    if not os.path.exists(L % tag): continue
    ref = 'base0' if tag.startswith('p1') or tag == 'stub' else 'stub'
    (a, sa), (b, sb) = get(ref), get(tag)
    diff = sorted(n for n in a if n in b and a[n] != b[n]); onlyb = sorted(set(b) - set(a)); onlya = sorted(set(a) - set(b))
    pe = {k: ('SAME' if a.get(k) == b.get(k) else 'DIFF') for k in a if k.endswith('>::parse_paren_expr')}
    kind = lambda n: 'JS' if 'P<false, ' in n else ('scan' if 'P<true, true>' in n else ('TS' if 'P<true, false>' in n else 'other'))
    print('== %s (against %s): parse_paren_expr %s; functions changed: JS %d, TS %d, scan %d, other %d; lint-only functions %d, %d bytes; text %+d bytes' % (
        tag, ref, ' '.join('%s=%s' % (re.search(r'P<\w+, \w+>', k).group(0).replace(' ', ''), v) for k, v in sorted(pe.items())),
        sum(1 for n in diff if kind(n) == 'JS'), sum(1 for n in diff if kind(n) == 'TS'), sum(1 for n in diff if kind(n) == 'scan'), sum(1 for n in diff if kind(n) == 'other'),
        len(onlyb), sum(sb.get(n, 0) for n in onlyb), sum(sb.get(n, 0) for n in b) - sum(sa.get(n, 0) for n in a)))
    for n in diff:
        if kind(n) == 'scan' and n.replace('P<true, true>', 'P<true, false>') in diff: continue
        if 'P<false, true>' in n and n.replace('P<false, true>', 'P<false, false>') in diff: continue
        ia, ca, _ = o['stat'](a[n]); ib, cb, _ = o['stat'](b[n])
        print('   %-5s insns %5d -> %5d (%+4d)  jcc %4d -> %4d (%+3d)  bytes %6d -> %6d  %s' % (kind(n), ia, ib, ib - ia, ca, cb, cb - ca, sa.get(n, 0), sb.get(n, 0), n[:110]))
    for n in onlya: print('   gone  %s' % n[:120])
    big = [n for n in onlyb if 'P<true, false>' in n and not re.search(r'lint_(mark|rewind|rewind_to|type|paren|arrow_param_type|arrow_return_type|try_arrow_return_type|after_paren_expr)$', n)]
    for n in big:
        ib, cb, _ = o['stat'](b[n]); print('   new   insns %5d  jcc %4d  bytes %6d  %s' % (ib, cb, sb.get(n, 0), n[:110]))
    c = cg(tag)
    if c and cgbase:
        for g in ('bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control'):
            if g in c: print('   cachegrind %-15s Ir %+10d (%+.5f%%)  Bc %+9d  Bi %+6d' % (g, c[g]['Ir'] - cgbase[g]['Ir'], 100.0 * (c[g]['Ir'] - cgbase[g]['Ir']) / cgbase[g]['Ir'], c[g]['Bc'] - cgbase[g]['Bc'], c[g]['Bi'] - cgbase[g]['Bi']))
