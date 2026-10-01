# One table per layer: functions by Rust file, codes, panics and asserts, callees by zone (earlier, forward), callers from earlier zones.
import collections
from zones import *
CODES = codes()
def dcodes(f): return set(CODES[d] for d in f['diags'] if d in CODES)
tn = tl = 0
for L in ORDER:
    fl = mine(L)
    n = sum(f['end'] - f['decl'] + 1 for f in fl)
    tn += len(fl); tl += n
    print('== %s functions %d lines %d' % (L, len(fl), n))
    bychunk = collections.OrderedDict()
    for f in fl: bychunk.setdefault('checker/%s.rs' % f['chunk'], []).append(f)
    for ch, ff in bychunk.items():
        print('file %s' % ch)
        for f in ff:
            extra = ''
            d = sorted(dcodes(f))
            if d: extra += ' codes=' + ','.join(str(c) for c, _ in d)
            if f['panics']: extra += ' PANIC@' + ','.join(str(p['line']) for p in f['panics'])
            if f['asserts']: extra += ' ASSERT@' + ','.join(str(p['line']) for p in f['asserts'])
            if f['program']: extra += ' PROGRAM=' + ','.join(sorted(set(p['text'] for p in f['program'])))
            if f['closures']: extra += ' closures=%d' % f['closures']
            print('   %d-%d %s%s' % (f['decl'], f['end'], short(f), extra))
    agg = set()
    for f in fl: agg |= dcodes(f)
    print('codes %d: %s' % (len(agg), ' '.join('TS%d%s' % (c, '' if cat == 'Error' else '(' + cat + ')') for c, cat in sorted(agg))))
    avail = collections.defaultdict(set); fwd = collections.defaultdict(set)
    for f in fl:
        for c in f['callees']:
            if c['pkg'] not in ('checker', 'binder'): continue
            t = target(c)
            if t is None or t['zone'] == L: continue
            (avail if t['rank'] < RANK[L] else fwd)[t['zone']].add(short(t))
    for k in sorted(avail, key=lambda k: (RANK.get(k, 99), k)): print('calls earlier %s (%d): %s' % (k, len(avail[k]), ' '.join(sorted(avail[k]))))
    for k in sorted(fwd, key=lambda k: (RANK.get(k, 99), k)): print('calls forward %s (%d): %s' % (k, len(fwd[k]), ' '.join(sorted(fwd[k]))))
    names = set((f['pkg'], f['q']) for f in fl)
    callers = collections.defaultdict(lambda: collections.defaultdict(set))
    for g in fns:
        if g['zone'] == L: continue
        for c in g['callees']:
            if (c['pkg'], c['name']) in names:
                callers['earlier' if g['rank'] < RANK[L] else 'later'][short(target(c))].add(g['zone'])
    for k in sorted(callers['earlier']): print('called from earlier %s <- %s' % (k, ','.join(sorted(callers['earlier'][k], key=lambda z: (RANK.get(z, 99), z)))))
    print('called from later only: %s' % ' '.join(sorted(set(callers['later']) - set(callers['earlier']))))
    called = set(callers['earlier']) | set(callers['later'])
    own = set()
    for f in fl:
        for c in f['callees']:
            t = target(c)
            if t is not None and t['zone'] == L and t is not f: own.add(short(t))
    print('called only inside the layer: %s' % ' '.join(sorted(own - called)))
    print('not called in checker or binder: %s' % ' '.join(sorted(set(short(f) for f in fl) - own - called)))
print('== total functions %d lines %d' % (tn, tl))
