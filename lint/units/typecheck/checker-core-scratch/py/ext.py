import sys, collections
sys.argv = ['x', 'none']
exec(open('/tmp/k3a/py/layers.py').read())
want = {'C-INIT','D-SINK','S-MERGE','N-RESOLVE','N-DIAG','A-ALIAS','M-MODULE','Q-ENTITY','T-KEYS','K-OBJ','T-RSTACK','MAPPER','LINKS'}
by = collections.defaultdict(set)
for f in fns:
    if f['layer'] in want:
        for c in f['callees']:
            pk = c.split('.')[0]
            if pk in ('checker',): continue
            if pk == 'binder' and (c.startswith('binder.NameResolver') or c in byname and byname[c][0]['file']=='binder/nameresolver.go'): continue
            by[pk].add(c[len(pk)+1:])
for pk in sorted(by):
    print(f"{pk} ({len(by[pk])}): " + ', '.join(sorted(by[pk])))
