import sys, collections
sys.argv = ['x', 'none']
exec(open('/tmp/k3a/py/layers.py').read())
want = {'C-INIT','D-SINK','S-MERGE','N-RESOLVE','N-DIAG','A-ALIAS','M-MODULE','Q-ENTITY','T-KEYS','K-OBJ','T-RSTACK','MAPPER','LINKS','TYPES'}
used = collections.defaultdict(set)
for f in fns:
    if f['layer'] in want:
        for c in f['callees']:
            t = byname.get(c)
            if t and t[0]['layer'] in ('UTIL','TYPES','MAPPER','T-KEYS','K-OBJ','T-RSTACK','D-SINK','LINKS') and t[0]['layer'] != f['layer']:
                used[(t[0]['layer'], t[0]['decl'], short(c))].add(f['layer'])
cur = None
for (layer, line, name), users in sorted(used.items()):
    if layer != cur:
        print('==', layer); cur = layer
    print(f"  {line} {name} <- {','.join(sorted(users))}")
