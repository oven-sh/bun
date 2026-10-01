# Joins the corpus coverage profiles of the reference (diagnostics only, and the full harness) with the layer functions.
# usage: corpus.py <fns.json> <cover.diag.out> <cover.full.out> <mode: funcs|never|services|panics|summary>
import json, sys, collections, bisect, os, re
src = open('/workspace/notes/lint/units/typecheck/checker-declarations-grammar-jsx/bottom-up/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1]); ORDER = ns['ORDER']
PFX = 'github.com/microsoft/typescript-go/internal/'
def load_profile(path):
    blocks = {}
    for ln in open(path):
        if ln.startswith('mode:'): continue
        loc, n, c = ln.rsplit(' ', 2)
        file, rng = loc.rsplit(':', 1)
        if file.startswith(PFX): file = file[len(PFX):]
        a, b = rng.split(',')
        sl = int(a.split('.')[0]); el = int(b.split('.')[0])
        key = (file, rng)
        prev = blocks.get(key)
        blocks[key] = (sl, el, int(n), max(int(c), prev[3] if prev else 0))
    return blocks
diag = load_profile(sys.argv[2]); full = load_profile(sys.argv[3])
byfile = collections.defaultdict(list)
for f in fns: byfile[f['file']].append(f)
for v in byfile.values(): v.sort(key=lambda f: f['start'])
starts = {k: [f['start'] for f in v] for k, v in byfile.items()}
def owner(file, line):
    v = byfile.get(file)
    if not v: return None
    i = bisect.bisect_right(starts[file], line) - 1
    if i < 0: return None
    f = v[i]
    return f if line <= f['end'] else None
def per_fn(blocks):
    res = collections.defaultdict(lambda: [0, 0, []])
    for (file, rng), (sl, el, n, c) in blocks.items():
        f = owner(file, sl)
        if f is None: continue
        t = res[(f['file'], f['decl'])]
        t[0] += n
        if c > 0: t[1] += n
        else: t[2].append((sl, el, n))
    return res
D = per_fn(diag); F = per_fn(full)
mine = [f for f in fns if f['layer']]
mode = sys.argv[4]
def key(f): return (f['file'], f['decl'])
def short(f): return ns['short'](f['name'])
if mode == 'summary':
    print('layer\tfunctions\tstatements\texecuted by corpus diagnostics: functions\tstatements\texecuted only by the full harness: functions\tnever: functions')
    for L in ORDER:
        fs = [f for f in mine if f['layer'] == L]
        st = sum(D[key(f)][0] for f in fs); cv = sum(D[key(f)][1] for f in fs)
        fd = [f for f in fs if D[key(f)][1] > 0]
        fe = [f for f in fs if D[key(f)][1] == 0 and F[key(f)][1] > 0]
        fn_ = [f for f in fs if D[key(f)][1] == 0 and F[key(f)][1] == 0]
        print(f"{L}\t{len(fs)}\t{st}\t{len(fd)}\t{cv}\t{len(fe)}\t{len(fn_)}")
if mode == 'never':
    print('layer\twhere\tfunction\tstatements\tmark (E = only the full harness runs it, N = the corpus never runs it)')
    for L in ORDER:
        for f in sorted([f for f in mine if f['layer'] == L], key=key):
            d = D[key(f)]; fu = F[key(f)]
            if d[1] > 0: continue
            print(f"{L}\t{f['file'].split('/')[-1]}:{f['decl']}-{f['end']}\t{short(f)}\t{d[0]}\t{'E' if fu[1] > 0 else 'N'}")
if mode == 'services':
    print('where\tfunction\tstatements\texecuted by corpus diagnostics')
    for f in sorted([f for f in mine if f['layer'] == 'Z-SERVICES'], key=key):
        d = D[key(f)]
        if d[1] > 0: print(f"{f['file'].split('/')[-1]}:{f['decl']}-{f['end']}\t{short(f)}\t{d[0]}\t{d[1]}")
if mode == 'partial':
    # functions of the layers that diagnostics enter, with the blocks that the corpus diagnostics never run
    print('layer\twhere\tfunction\tstatements\texecuted\tblocks never run by corpus diagnostics (first line-last line)')
    for L in ORDER:
        if L == 'Z-SERVICES': continue
        for f in sorted([f for f in mine if f['layer'] == L], key=key):
            d = D[key(f)]
            if d[1] == 0 or d[1] == d[0]: continue
            miss = sorted(d[2])
            print(f"{L}\t{f['file'].split('/')[-1]}:{f['decl']}-{f['end']}\t{short(f)}\t{d[0]}\t{d[1]}\t{' '.join(f'{a}-{b}' for a, b, n in miss)}")
if mode == 'panics':
    print('layer\twhere\tfunction\tkind\texecuted by corpus diagnostics\texecuted by the full harness\ttext')
    def cov(blocks, file, line):
        hit = None
        for (fl, rng), (sl, el, n, c) in blocks.items():
            if fl != file or not (sl <= line <= el): continue
            if hit is None or (el - sl) < (hit[1] - hit[0]): hit = (sl, el, c)
        return '?' if hit is None else ('yes' if hit[2] > 0 else 'no')
    for L in ORDER:
        for f in sorted([f for f in mine if f['layer'] == L], key=key):
            for kind in ('panics', 'asserts'):
                for p in f[kind]:
                    print(f"{L}\t{f['file'].split('/')[-1]}:{p['line']}\t{short(f)}\t{kind[:-1]}\t{cov(diag, f['file'], p['line'])}\t{cov(full, f['file'], p['line'])}\t{p['text'][:110]}")
