# One table per layer: functions by Rust file, codes, panics, map ranges, callees by layer, callers from the core layers, links.
import collections, json
from layers import *
CODES = codes()
def later_group(f):
    if f['file'] == C: return f['chunk'].split('/')[-1][:-3]
    return f['file'].split('/')[-1][:-3]
total_n = 0; total_lines = 0
for L in ORDER:
    fl = mine(L)
    n = sum(f['end'] - f['decl'] + 1 for f in fl)
    total_n += len(fl); total_lines += n
    print('== %s functions %d lines %d' % (L, len(fl), n))
    bychunk = collections.OrderedDict()
    for f in fl: bychunk.setdefault(f['chunk'], []).append(f)
    for ch, ff in bychunk.items():
        print('file %s' % ch)
        for f in ff:
            print('   %d-%d %s' % (f['decl'], f['end'], short(f['name'])))
    agg = set()
    for f in fl:
        for d in f['diags']:
            c = CODES.get(d)
            if c: agg.add(c)
    print('codes ' + ' '.join('TS%d%s' % (c, '' if cat == 'Error' else '(' + cat + ')') for c, cat in sorted(agg)))
    for f in fl:
        for p in f['panics']: print('panic %s:%d %s %s' % (f['file'].split('/')[-1], p['line'], short(f['name']), p['text']))
        for p in f['asserts']: print('assert %s:%d %s %s' % (f['file'].split('/')[-1], p['line'], short(f['name']), p['text']))
    for f in fl:
        for p in f['maprange']: print('maprange %s:%d %s %s' % (f['file'].split('/')[-1], p['line'], short(f['name']), p['text']))
    core = collections.defaultdict(set); own = collections.defaultdict(set); later = collections.defaultdict(set)
    for f in fl:
        for cname in f['callees']:
            t = byname.get(cname)
            if not t or t['layer'] == L: continue
            tl = t['layer']
            if tl in CORESET: core[tl].add(short(cname))
            elif tl in IDX: own[tl].add(short(cname))
            else: later[later_group(t)].add('%s@%d' % (short(cname), t['decl']))
    for k in sorted(core): print('calls core %s: %s' % (k, ' '.join(sorted(core[k]))))
    for k in sorted(own, key=lambda k: IDX[k]):
        if IDX[k] < IDX[L]: print('calls earlier %s: %s' % (k, ' '.join(sorted(own[k]))))
    for k in sorted(own, key=lambda k: IDX[k]):
        if IDX[k] > IDX[L]: print('calls forward %s: %s' % (k, ' '.join(sorted(own[k]))))
    for k in sorted(later): print('calls later %s: %s' % (k, ' '.join(sorted(later[k]))))
    names = set(f['name'] for f in fl)
    callers = collections.defaultdict(set)
    for g in fns:
        if g['layer'] in CORESET:
            for cname in g['callees']:
                if cname in names: callers[short(cname)].add(g['layer'])
    for k in sorted(callers): print('called from core %s <- %s' % (k, ','.join(sorted(callers[k]))))
    lk = collections.Counter()
    for f in fl:
        for l in f['links']: lk[l if isinstance(l, str) else json.dumps(l, sort_keys=True)] += 1
    print('links ' + ' '.join('%s:%d' % (k, v) for k, v in sorted(lk.items())))
print('== total functions %d lines %d' % (total_n, total_lines))
