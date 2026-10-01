# Counts per layer: functions, lines, closures, codes, callees that land later (stand-ins the layer needs) by group,
# and functions of the layer that earlier steps call (stand-ins the layer removes).
import collections
from zones import *
CODES = codes()
def group(z):
    if z in ORDER: return 'this unit'
    if z in ('I-INFER', 'I-REVMAP'): return 'inference'
    if z in ('K-KEYOF', 'K-INDEXED', 'K-SUBST', 'K-COND', 'T-MAPPED', 'K-TEMPLATE', 'K-IMPORTTYPE'): return 'keyof..template'
    if z == 'X-JSX': return 'jsx'
    if z == 'X-GRAMMAR': return 'grammar'
    if z in ('X-ITER', 'X-ASYNC'): return 'iteration, awaited'
    if z in ('X-DECORATOR', 'X-COLLISION', 'X-MARKREF'): return 'decorators, collisions, mark references'
    return 'declaration checks and the rest'
GROUPS = ['this unit', 'inference', 'keyof..template', 'iteration, awaited', 'jsx', 'grammar', 'decorators, collisions, mark references', 'declaration checks and the rest']
print('layer\tposition\tfunctions\tlines\tclosures\tcodes\tpanics\tasserts\t' + '\t'.join('forward: ' + g for g in GROUPS) + '\tforward total\tcalled from earlier steps')
for L in ORDER:
    fl = mine(L)
    fwd = collections.defaultdict(set)
    for f in fl:
        for c in f['callees']:
            if c['pkg'] not in ('checker', 'binder'): continue
            t = target(c)
            if t is None or t['zone'] == L or t['rank'] < RANK[L]: continue
            fwd[group(t['zone'])].add(short(t))
    names = set((f['pkg'], f['q']) for f in fl)
    earlier = set()
    for g in fns:
        if g['zone'] != L and g['rank'] < RANK[L]:
            for c in g['callees']:
                if (c['pkg'], c['name']) in names: earlier.add(c['name'])
    codeset = set()
    for f in fl: codeset |= set(CODES[d] for d in f['diags'] if d in CODES)
    print('%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%s\t%d\t%d' % (L, RANK[L], len(fl), sum(f['end'] - f['decl'] + 1 for f in fl), sum(f['closures'] for f in fl), len(codeset),
          sum(len(f['panics']) for f in fl), sum(len(f['asserts']) for f in fl), '\t'.join(str(len(fwd[g])) for g in GROUPS), sum(len(v) for v in fwd.values()), len(earlier)))
