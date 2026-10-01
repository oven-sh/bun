# Work tables for the twelve layers. usage: tables.py <mode>
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import layers as L
ORDER = L.ORDER; RANK = L.RANK
mode = sys.argv[1]
def later(caller_layer, callee_layer):
    return RANK.get(callee_layer, 999) > RANK[caller_layer]
if mode == 'funcs':
    for lay in ORDER:
        fs = L.ours(lay)
        print('== %s: %d functions, %d lines' % (lay, len(fs), sum(f['end'] - f['decl'] + 1 for f in fs)))
        bymod = collections.OrderedDict()
        for f in fs: bymod.setdefault(f['module'], []).append(f)
        for m, ff in bymod.items():
            print(' %s: %s' % (m, ' '.join('%s@%d-%d' % (L.short(f).replace('c.', ''), f['decl'], f['end']) for f in ff)))
if mode == 'in':
    # callees in layers that come later than the caller's layer: stand-ins that the layer needs when it lands
    for lay in ORDER:
        agg = collections.defaultdict(lambda: collections.defaultdict(set))
        for f in L.ours(lay):
            for t, c in L.callees(f):
                if t['layer'] == lay: continue
                if later(lay, t['layer']):
                    agg[t['layer']]['%s@%s' % (L.short(t).replace('c.', ''), L.loc(t).replace('checker.go:', '').replace('.go', ''))].add(L.short(f).replace('c.', ''))
        n = sum(len(v) for v in agg.values())
        print('== %s needs %d stand-ins for later layers' % (lay, n))
        for tl in sorted(agg, key=lambda x: RANK.get(x, 999)):
            print(' %s (%d): %s' % (tl, len(agg[tl]), ' '.join(sorted(agg[tl]))))
if mode == 'inusers':
    for lay in ORDER:
        agg = collections.defaultdict(lambda: collections.defaultdict(set))
        for f in L.ours(lay):
            for t, c in L.callees(f):
                if t['layer'] == lay: continue
                if later(lay, t['layer']):
                    agg[t['layer']][L.short(t).replace('c.', '')].add(L.short(f).replace('c.', ''))
        print('== %s' % lay)
        for tl in sorted(agg, key=lambda x: RANK.get(x, 999)):
            for k in sorted(agg[tl]):
                print('%s\t%s\t%s\t<- %s' % (lay, tl, k, ', '.join(sorted(agg[tl][k]))))
if mode == 'out':
    # functions of the twelve layers that earlier layers call: the earlier layers carry a stand-in until the layer lands
    agg = collections.defaultdict(lambda: collections.defaultdict(set))
    for f in L.fns:
        if f['layer'] in ('?',): continue
        for t, c in L.callees(f):
            if not t['mine']: continue
            if t['layer'] == f['layer']: continue
            if RANK.get(f['layer'], 999) < RANK[t['layer']]:
                agg[t['layer']]['%s@%d' % (L.short(t).replace('c.', ''), t['decl'])].add(f['layer'])
    for lay in ORDER:
        print('== %s: %d functions are called from earlier layers' % (lay, len(agg[lay])))
        for k in sorted(agg[lay], key=lambda k: int(k.split('@')[1])):
            print(' %s <- %s' % (k, ','.join(sorted(agg[lay][k], key=lambda x: RANK.get(x, 999)))))
if mode == 'codes':
    for lay in ORDER:
        s = collections.defaultdict(set)
        for f in L.ours(lay):
            for d in L.diagcodes(f): s[d].add(L.short(f))
        nums = sorted([int(x) for x in s if x.isdigit()])
        print('%s\t%d\t%s' % (lay, len(nums), ','.join(map(str, nums))))
if mode == 'fields':
    agg = collections.defaultdict(lambda: collections.defaultdict(int))
    for f in L.ours():
        for fld in f.get('fields') or []:
            agg[fld][f['layer']] += 1
    for fld in sorted(agg):
        print(fld + '\t' + ', '.join('%s:%d' % (k, v) for k, v in sorted(agg[fld].items(), key=lambda kv: ORDER.index(kv[0]))))
if mode == 'links':
    agg = collections.defaultdict(lambda: collections.defaultdict(list))
    for f in L.ours():
        for l in f.get('links') or []:
            agg[l][f['layer']].append(L.short(f).replace('c.', ''))
    for l in sorted(agg):
        print(l + '\t' + '; '.join('%s: %s' % (k, ' '.join(v)) for k, v in sorted(agg[l].items(), key=lambda kv: ORDER.index(kv[0]))))
if mode in ('panics', 'asserts', 'defers', 'casts', 'maprange', 'program', 'symw', 'tracer'):
    for f in L.ours():
        for s in f.get(mode) or []:
            print('%s\t%s:%d\t%s\t%s' % (f['layer'], f['file'].split('/')[-1], s['line'], L.short(f), s['text']))
