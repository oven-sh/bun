# Stand-ins of the layers: mode `in` lists, per layer, the functions that a core layer or an earlier layer of the unit calls;
# mode `later` lists the callees in other units with their Go signature and the layers that call them.
import collections, re, sys
from layers import *
mode = sys.argv[1]
if mode == 'in':
    for L in ORDER:
        names = set(f['name'] for f in mine(L))
        callers = collections.defaultdict(set)
        for g in fns:
            gl = g['layer']
            if gl == L or not (gl in CORESET or (gl in IDX and IDX[gl] < IDX[L])): continue
            for cname in g['callees']:
                if cname in names: callers[short(cname)].add(gl)
        print('== %s functions %d, with a caller in a core layer or an earlier layer %d' % (L, len(names), len(callers)))
        for k in sorted(callers):
            print('%s <- %s' % (k, ','.join(sorted(callers[k], key=lambda x: (x not in CORESET, IDX.get(x, 0), x)))))
if mode == 'later':
    later = collections.defaultdict(set)
    for L in ORDER:
        for f in mine(L):
            for cname in f['callees']:
                t = byname.get(cname)
                if not t or t['layer'] in CORESET or t['layer'] in IDX: continue
                later[cname].add(L)
    print('upstream\tGo signature\tcalled from')
    for cname in sorted(later, key=lambda n: (byname[n]['file'], byname[n]['decl'])):
        t = byname[cname]
        sig = source(t['file'])[t['decl'] - 1].strip()
        sig = re.sub(r'^func \(c \*Checker\) ', 'c.', sig)
        sig = re.sub(r'^func ', '', sig).rstrip('{').strip()
        print('%s:%d\t%s\t%s' % (t['file'].split('/')[-1], t['decl'], sig, ','.join(sorted(later[cname], key=lambda k: IDX[k]))))
