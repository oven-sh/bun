# One compact block per layer: functions by Rust file in upstream order, callers before the layer, callees after it, codes, panics.
# A trailing `*` marks a function with a caller in a core layer or an earlier layer, `+` one that the upstream run of min.ts enters.
import collections, os
from layers import *
CODES = codes()
K4 = set()
p4 = os.path.dirname(os.path.abspath(__file__)) + '/../../checker-type-layers-scratch/groundtruth/out/k4.entered.txt'
for l in open(p4):
    p = l.rstrip('\n').split('\t')
    if len(p) >= 3 and ':' in p[1]:
        f, ln = p[1].rsplit(':', 1)
        K4.add((f, int(ln)))
allf = sorted([f for f in fns if f['file'] in (C, R)], key=lambda f: (f['file'], f['decl']))
for L in ORDER:
    fl = mine(L)
    names = set(f['name'] for f in fl)
    inc = set()
    for g in fns:
        gl = g['layer']
        if gl == L or not (gl in CORESET or (gl in IDX and IDX[gl] < IDX[L])): continue
        inc.update(c for c in g['callees'] if c in names)
    print('### %s: %d functions, %d lines, min.ts enters %d' % (L, len(fl), sum(f['end'] - f['decl'] + 1 for f in fl), sum(1 for f in fl if (f['file'], f['decl']) in K4)))
    cur = None; runs = []
    for f in allf:
        if f['layer'] == L:
            if cur and cur['chunk'] == f['chunk'] and cur['open']:
                cur['end'] = f['end']; cur['fs'].append(f)
            else:
                cur = {'chunk': f['chunk'], 'start': f['decl'], 'end': f['end'], 'fs': [f], 'open': True}; runs.append(cur)
        elif cur: cur['open'] = False
    for r in runs:
        items = [short(f['name']).replace('c.', '') + ('*' if f['name'] in inc else '') + ('+' if (f['file'], f['decl']) in K4 else '') for f in r['fs']]
        print('FN %s %d-%d: %s' % (r['chunk'].split('/')[-1], r['start'], r['end'], ' '.join(items)))
    own = collections.defaultdict(set); other = set(); agg = set()
    for f in fl:
        for d in f['diags']:
            if d in CODES: agg.add(CODES[d][0])
        for cname in f['callees']:
            t = byname.get(cname)
            if not t or t['layer'] == L or t['layer'] in CORESET: continue
            if t['layer'] in IDX:
                if IDX[t['layer']] > IDX[L]: own[t['layer']].add(short(cname).replace('c.', ''))
            else: other.add('%s@%s:%d' % (short(cname).replace('c.', ''), t['file'].split('/')[-1][:-3], t['decl']))
    print('OUT own later layers: ' + '; '.join('%s %s' % (k, ' '.join(sorted(own[k]))) for k in sorted(own, key=lambda k: IDX[k])))
    print('OUT other units: ' + ' '.join(sorted(other)))
    print('CODES ' + ' '.join('TS%d' % c for c in sorted(agg)))
    for f in fl:
        for p in f['panics'] + f['asserts']: print('PANIC %s:%d %s %s' % (f['file'].split('/')[-1], p['line'], short(f['name']), p['text'][:110]))
